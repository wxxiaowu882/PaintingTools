package com.wuxiaoart.workshop

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 薄壳：全屏 WebView 加载线上站。不打包站点资源。
 * 须支持：文件选图、同域 Cookie、blob/data、可选摄像头（描摹）、壳强制更新。
 */
class MainActivity : AppCompatActivity() {

    private data class ShellUpdateInfo(
        val minVersionCode: Int,
        val latestVersionCode: Int,
        val versionName: String,
        val downloadUrl: String,
        val message: String
    )

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    /** 强制更新弹窗打开时，返回键直接退出，不进站 */
    private var forceUpdateBlocking = false

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            cb.onReceiveValue(uris)
        }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val req = pendingPermissionRequest
            pendingPermissionRequest = null
            if (req == null) return@registerForActivityResult
            if (granted) {
                req.grant(req.resources)
            } else {
                req.deny()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // 冷启动全程深色底，避免 WebView 默认白底闪一下
        window.decorView.setBackgroundColor(0xFF050505.toInt())
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        progressBar = findViewById(R.id.progress)
        webView.setBackgroundColor(0xFF050505.toInt())

        // 全屏交给网页 CSS safe-area；根布局再垫 systemBars 会与 100dvh 叠出「整页可滚 1px」，
        // 与课表 overflow 列表抢手势（仅壳复现反向/卡顿；浏览器无此双重留白）
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets -> insets }

        setupWebView()
        setupBackPress()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // 先查 App 版本；网页内容更新不走这里
            checkShellUpdateThenLoad()
        }
    }

    /**
     * 每页注入：锁文档滚动 + 壳标记（减轻内层列表与 WebView 整页抢滑）。
     * 首页额外显示右下角「V1.0.x」（网页可读 window.__SHELL_VERSION__）。
     */
    private fun injectShellPageHelpers(url: String?) {
        val path = (Uri.parse(url ?: "").path ?: "").lowercase()
        val isHome = path.isEmpty() || path == "/" || path == "/index" || path.endsWith("/index.html")
        val verLiteral = JSONObject.quote(BuildConfig.VERSION_NAME)
        val homeBadgeJs = if (isHome) {
            """
              try {
                window.__SHELL_VERSION__ = $verLiteral;
                var el = document.getElementById('shell-version-badge');
                if (!el) {
                  el = document.createElement('div');
                  el.id = 'shell-version-badge';
                  el.setAttribute('aria-hidden','true');
                  el.style.cssText = 'position:fixed;right:10px;bottom:max(10px,env(safe-area-inset-bottom,0px));z-index:40;padding:3px 8px;font-size:10px;letter-spacing:0.08em;color:rgba(255,255,255,0.42);pointer-events:none;font-family:Inter,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;font-weight:300;';
                  (document.body || document.documentElement).appendChild(el);
                }
                el.textContent = 'V' + window.__SHELL_VERSION__;
              } catch (eBadge) {}
            """.trimIndent()
        } else {
            "try { window.__SHELL_VERSION__ = $verLiteral; } catch (eVer) {}"
        }
        val js = """
            (function(){
              try {
                document.documentElement.classList.add('wuxiao-android-shell');
                var s = document.getElementById('wuxiao-shell-scroll-fix');
                if (!s) {
                  s = document.createElement('style');
                  s.id = 'wuxiao-shell-scroll-fix';
                  s.textContent =
                    'html.wuxiao-android-shell,html.wuxiao-android-shell body{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important;width:100%!important;background:#050505!important;}' +
                    'html.wuxiao-android-shell .scene-grid{-webkit-overflow-scrolling:auto!important;}' +
                    'html.wuxiao-android-shell #scene-grid-modal{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}' +
                    'html.wuxiao-android-shell .index-about-app,' +
                    'html.wuxiao-android-shell .menu-item[data-menu-url=\"/docs/app/\"],' +
                    'html.wuxiao-android-shell .menu-item[data-menu-url=\"/docs/app\"],' +
                    'html.wuxiao-android-shell .menu-category[data-menu-cat=\"install\"]{display:none!important;}';
                  (document.head || document.documentElement).appendChild(s);
                }
                try { window.scrollTo(0, 0); } catch (e0) {}
                try { document.documentElement.scrollTop = 0; } catch (e1) {}
                try { if (document.body) document.body.scrollTop = 0; } catch (e2) {}
                $homeBadgeJs
              } catch (e) {}
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    /**
     * 读站点 docs/app/android-shell-update.json。
     * 仅当本机 versionCode 低于 minVersionCode 时强制更新；
     * 拉配置失败则放行（避免未发版或断网导致永久进不去）。
     */
    private fun checkShellUpdateThenLoad() {
        progressBar.visibility = View.VISIBLE
        progressBar.isIndeterminate = true
        Thread {
            val info = runCatching { fetchShellUpdateInfo() }.getOrNull()
            runOnUiThread {
                progressBar.isIndeterminate = false
                if (info != null && BuildConfig.VERSION_CODE < info.minVersionCode) {
                    showForceUpdateDialog(info)
                } else {
                    webView.loadUrl(BuildConfig.START_URL)
                }
            }
        }.start()
    }

    private fun fetchShellUpdateInfo(): ShellUpdateInfo {
        val start = Uri.parse(BuildConfig.START_URL)
        val origin = "${start.scheme}://${start.host}"
        val jsonUrl = origin + BuildConfig.UPDATE_JSON_PATH
        val conn = (URL(jsonUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 12_000
            readTimeout = 12_000
            requestMethod = "GET"
            setRequestProperty("Cache-Control", "no-cache")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                error("update json HTTP $code")
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val o = JSONObject(body)
            val minVc = o.getInt("minVersionCode")
            val latestVc = o.optInt("latestVersionCode", minVc)
            val name = o.optString("versionName", "")
            val msg = o.optString(
                "message",
                "发现新版本，请更新「手绘工坊」后继续使用。"
            )
            val apkPath = o.optString("apkPath", "/docs/app/wuxiao-workshop.apk")
            val download = when {
                apkPath.startsWith("http://") || apkPath.startsWith("https://") -> apkPath
                apkPath.startsWith("/") -> origin + apkPath
                else -> "$origin/$apkPath"
            }
            return ShellUpdateInfo(minVc, latestVc, name, download, msg)
        } finally {
            conn.disconnect()
        }
    }

    private fun showForceUpdateDialog(info: ShellUpdateInfo) {
        forceUpdateBlocking = true
        progressBar.visibility = View.GONE
        val title = if (info.versionName.isNotBlank()) {
            "需要更新到 ${info.versionName}"
        } else {
            "需要更新应用"
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(info.message)
            .setCancelable(false)
            .setPositiveButton("下载更新") { _, _ ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(info.downloadUrl)))
                } catch (_: Exception) {
                }
                // 装完需重新打开；此处退出，避免旧壳继续用
                finish()
            }
            .setNegativeButton("退出") { _, _ -> finish() }
            .setOnDismissListener {
                if (forceUpdateBlocking) {
                    // 系统仍可能关掉对话框；保持不进站
                }
            }
            .show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        // 关系统 overscroll：否则内层 overflow 列表惯性滚时，外层回弹易被感知成「反向滑」
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            // overview 缩放布局易与内层列表纵向滑抢手势（1.0.6 关 zoom 后仍有反向，本版关掉）
            loadWithOverviewMode = false
            // 站内页已 user-scalable=no，看大图靠页面自管；开系统缩放会与课表纵向滑抢手势（仅壳复现）
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // 相册选图返回 content://，须允许 WebView 读 content
            allowContentAccess = true
            allowFileAccess = false
            // 关闭多窗口：window.open/_blank 在壳内易闪退；由 shouldOverride 同页导航
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url ?: return false
                return handleNavigation(uri)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return handleNavigation(Uri.parse(url))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
                CookieManager.getInstance().flush()
                injectShellPageHelpers(url)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            // GR / XStudio / ARSketch：网页 input[type=file][accept=image]
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = try {
                    fileChooserParams?.createIntent()
                        ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                        }
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }

            /** 描摹助手摄像头等 */
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val needsCamera = request.resources.any {
                    it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                }
                if (!needsCamera) {
                    request.grant(request.resources)
                    return
                }
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingPermissionRequest = request
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }
        }
    }

    /**
     * 同域留在壳内；blob/data/about/javascript 交给 WebView；
     * 外链 / mailto / tel 走系统。
     */
    private fun handleNavigation(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        when (scheme) {
            "http", "https" -> {
                val host = uri.host?.lowercase() ?: return false
                if (isOurHost(host)) {
                    return false
                }
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (_: Exception) {
                }
                return true
            }
            "blob", "data", "about", "javascript" -> return false
            "mailto", "tel", "sms" -> {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (_: Exception) {
                }
                return true
            }
            else -> {
                // 未知协议：不抢，避免误杀站内特殊 URL
                return false
            }
        }
    }

    private fun isOurHost(host: String): Boolean {
        return host == "wuxiaoart.com" ||
            host == "www.wuxiaoart.com" ||
            host == "test.wuxiaoart.com" ||
            host.endsWith(".wuxiaoart.com")
    }

    private fun setupBackPress() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (forceUpdateBlocking) {
                        finish()
                        return
                    }
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            }
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        pendingPermissionRequest?.deny()
        pendingPermissionRequest = null
        webView.destroy()
        super.onDestroy()
    }
}

/**
 * 各槽语义卡（只描述应落/禁落/采样模式，不含大本坐标）
 * 名称对齐大本 keyPoints；采样 side 驱动 proposeCandidates
 */
const V02 = {
  1: {
    name: '颅顶点',
    kind: '凸起',
    where: '颅盖正中最高点（近中线顶弧）',
    forbid: '顶弧左坡、耳、肩',
    pickHint: '选 localY 最高',
    band: { v0: 0.08, v1: 0.22, side: 'apexHighest' }
  },
  2: {
    name: '脑颅侧方最宽点',
    kind: '凸起',
    where: '脑颅最宽（耳壳除外），偏后',
    forbid: '耳轮、额颞前坡',
    pickHint: '选最负 x，允许略负 z',
    band: { v0: 0.2, v1: 0.32, side: 'left', allowBack: true, preferWidest: true }
  },
  3: {
    name: '颧骨弓隆起',
    kind: '凸起',
    where: '外眼角高度颧弓最外，忽略耳后',
    forbid: '耳、耳垂',
    pickHint: '前脸最左缘',
    band: { v0: 0.32, v1: 0.42, side: 'left', ignoreEar: true, preferFaceZ: true, minZ: 0.02, maxZ: 0.055 }
  },
  4: {
    name: '颊转角',
    kind: '凸起',
    where: '口角高度咬肌上颊转角',
    forbid: '下颌角、颈、肩',
    band: { v0: 0.4, v1: 0.48, side: 'left', jawFace: true },
    preferBetween: true,
    between: ['3', '5'],
    betweenBias: 0.55,
    betweenXNudge: -0.008,
    betweenYNudge: -0.01,
    betweenZNudge: 0.004,
    betweenMinDist: 0.008
  },
  5: {
    name: '颏结节',
    kind: '凸起',
    where: '颏左结节（须在口下颏底，勿落唇）',
    forbid: '颈前、肩、口唇',
    band: { v0: 0.54, v1: 0.68, side: 'chinL' }
  },
  6: {
    name: '颏底',
    kind: '凸起',
    where: '颏底最低近中线（须在口下，勿落唇缝）',
    forbid: '喉结、胸窝、口唇',
    band: { v0: 0.56, v1: 0.7, side: 'chinC' }
  },
  A: {
    name: '角前切迹',
    kind: '凹陷',
    where: '咬肌前切迹，4与5之间',
    forbid: '颈侧、肩',
    band: { v0: 0.46, v1: 0.54, side: 'left', jawFace: true },
    preferBetween: true,
    between: ['4', '5'],
    betweenBias: 0.5,
    betweenXNudge: -0.006,
    betweenYNudge: -0.004,
    betweenZNudge: 0.004,
    betweenMinDist: 0.006
  }
};

/** 侧/大半侧/全侧：当前相机剪影左缘（远端脸廓） */
function sil(name, kind, where, forbid, v0, v1, extra) {
  return {
    name,
    kind,
    where,
    forbid: forbid || '耳壳外缘、肩',
    pickHint: kind === '凹陷' ? '选凹转' : '选凸点',
    band: Object.assign({ v0, v1, side: 'silLeft', preferFaceZ: true }, extra || {})
  };
}

/** 侧前远端：farCheek = 屏左扫中「颊区」最负 x，避开鼻尖抢左缘 */
function silFar(name, kind, where, forbid, v0, v1, extra) {
  return {
    name,
    kind,
    where,
    forbid: forbid || '近侧耳颞、鼻尖、肩',
    pickHint: '远端颊廓（非鼻尖）',
    band: Object.assign({ v0, v1, side: 'farCheek' }, extra || {})
  };
}

const V01 = {
  1: silFar('额结节', '凸起', '远端额结节外轮廓', '近侧耳颞', 0.16, 0.26),
  2: silFar('眉弓', '凸起', '远端眉弓外缘', null, 0.26, 0.34),
  3: silFar('颧突隆', '凸起', '远端颧突隆（主课）', '近侧、鼻', 0.34, 0.46),
  A:Object.assign(silFar('眉弓上缘', '凹陷', '眉弓上缘凹（远端剪影，介于1–2）', null, 0.2, 0.28),{between:['1','2'],betweenBias:0.45,betweenXNudge:-0.004,betweenMinDist:0.006}),
  B:Object.assign(silFar('外眼角后收处', '凹陷', '外眼角后收（远端剪影，介于2–3）', '鼻翼', 0.3, 0.38),{between:['2','3'],betweenBias:0.55,betweenXNudge:-0.008,betweenZNudge:-0.006,betweenMinDist:0.008}),
  // 下半脸：5 可 preferBetween；其余 propose 优先，空/撞点再 between
  5:Object.assign(silFar('颏肌', '凸起', '颏肌外轮廓（勿落颈）', '颈、肩', 0.48, 0.56),{preferBetween:true,between:['3','3'],betweenBias:0,betweenXNudge:-0.012,betweenYNudge:-0.055,betweenZNudge:-0.01,betweenMinDist:0.014}),
  4:Object.assign(silFar('口轮匝肌', '凸起', '口轮匝肌侧缘外轮廓', null, 0.42, 0.5),{between:['3','5'],betweenBias:0.45,betweenXNudge:-0.01,betweenYNudge:-0.004,betweenZNudge:-0.008,betweenMinDist:0.01}),
  C: {
    name: '颊凹',
    kind: '凹陷',
    where: '颊凹（颧突隆与口轮匝肌之间的远端颊凹，勿鼻翼）',
    forbid: '口角、鼻翼',
    pickHint: '远端颊面',
    band: { v0: 0.38, v1: 0.48, side: 'farCheekInset' },
    preferBetween: true,
    between: ['3', '4'],
    betweenBias: 0.45,
    betweenXNudge: -0.006,
    betweenYNudge: -0.002,
    betweenZNudge: -0.006,
    betweenMinDist: 0.005
  },
  D: {
    name: '口轮匝肌下缘',
    kind: '凹陷',
    where: '口轮匝肌下缘（口轮匝肌与颏肌之间的远端颌缘，勿口角）',
    forbid: '口角、颈、肩',
    pickHint: '远端颌缘',
    band: { v0: 0.46, v1: 0.56, side: 'farCheekInset' },
    preferBetween: true,
    between: ['4', '5'],
    betweenBias: 0.4,
    betweenXNudge: -0.006,
    betweenYNudge: -0.002,
    betweenZNudge: -0.006,
    betweenMinDist: 0.005
  }
};

const V03 = {
  1: sil('额结节', '凸起', '额—鼻—唇—颏剪影上额结节', null, 0.16, 0.26),
  2: sil('眉弓', '凸起', '眉弓剪影', null, 0.26, 0.34),
  3: sil('鼻头', '凸起', '鼻头剪影最前', null, 0.34, 0.42, { preferFront: true }),
  4: sil('上唇白脊', '凸起', '上唇白脊线', null, 0.42, 0.48, { preferFront: true }),
  5: sil('下唇白脊', '凸起', '下唇白脊线', null, 0.46, 0.52, { preferFront: true }),
  6:Object.assign(sil('颏肌', '凸起', '颏肌前突', null, 0.5, 0.56, { preferFront: true }),{preferBetween:true,between:['5','E'],betweenBias:0.4,betweenZNudge:0.012,betweenYNudge:-0.006}),
  7:Object.assign(sil('颏底', '凸起', '颏底前缘（勿落喉）', '喉、肩', 0.54, 0.6, { preferFront: true }),{preferBetween:true,between:['6','E'],betweenBias:0.85,betweenZNudge:0.004,betweenYNudge:-0.018}),
  A: sil('眉弓上缘', '凹陷', '眉弓上缘', null, 0.22, 0.3),
  B: sil('眼裂', '凹陷', '眼裂', null, 0.32, 0.4),
  C: sil('鼻唇角', '凹陷', '鼻唇角', null, 0.4, 0.48, { preferFront: true }),
  D:Object.assign(sil('唇缝', '凹陷', '唇缝（介于上下唇白脊）', null, 0.46, 0.52, { preferFront: true }),{preferBetween:true,between:['5','6'],betweenBias:0.35,betweenZNudge:0.006,betweenMinDist:0.01}),
  E:Object.assign(sil('颏唇沟', '凹陷', '颏唇沟（介于颏肌与颏底）', null, 0.5, 0.56, { preferFront: true }),{preferBetween:true,between:['6','7'],betweenBias:0.45,betweenZNudge:0.004,betweenYNudge:-0.006,betweenMinDist:0.01}),
  F: sil('颈点', '凹陷', '颈点（勿落肩）', '肩', 0.6, 0.72)
};

const V04 = {
  1: sil('眉弓', '凸起', '全侧眉弓', null, 0.22, 0.32, { preferFront: true }),
  2: sil('鼻头', '凸起', '鼻头', null, 0.34, 0.42, { preferFront: true }),
  3: sil('上唇白脊', '凸起', '上唇白脊', null, 0.42, 0.48, { preferFront: true }),
  4: sil('下唇白脊', '凸起', '下唇白脊', null, 0.46, 0.52, { preferFront: true }),
  5:Object.assign(sil('颏凸隆', '凸起', '颏凸隆', null, 0.5, 0.56, { preferFront: true }),{preferBetween:true,between:['4','E'],betweenBias:0.45,betweenZNudge:0.01,betweenYNudge:-0.004}),
  6:Object.assign(sil('颏底', '凸起', '颏底（勿落喉）', '喉、肩', 0.54, 0.6, { preferFront: true }),{preferBetween:true,between:['5','E'],betweenBias:0.8,betweenZNudge:0.006,betweenYNudge:-0.016}),
  7: { name: '枕后凸隆', kind: '凸起', where: '枕后', forbid: '肩', band: { v0: 0.2, v1: 0.4, side: 'silRight' } },
  8: {
    name: '颅顶点',
    kind: '凸起',
    where: '侧视颅顶最高',
    forbid: '发量假高',
    pickHint: '选最高',
    band: { v0: 0.05, v1: 0.22, side: 'apexHighest', u0: 0.3, u1: 0.75, maxAbsX: 0.12 }
  },
  9: { name: '发际点', kind: '凸起', where: '额发际', forbid: null, band: { v0: 0.14, v1: 0.24, side: 'silLeft' } },
  A: sil('眉弓上缘', '凹陷', '眉弓上缘', null, 0.18, 0.28),
  B: sil('鼻根', '凹陷', '鼻根', null, 0.28, 0.36, { preferFront: true }),
  C: sil('鼻唇角', '凹陷', '鼻唇角', null, 0.4, 0.48, { preferFront: true }),
  D: sil('唇缝', '凹陷', '唇缝', null, 0.44, 0.5, { preferFront: true }),
  E: sil('颏唇沟', '凹陷', '颏唇沟', null, 0.48, 0.54, { preferFront: true }),
  F: sil('颈点', '凹陷', '颈点', '肩', 0.6, 0.72),
  G: { name: '风府', kind: '凹陷', where: '枕下风府', forbid: '肩', band: { v0: 0.35, v1: 0.5, side: 'silRight' } }
};

const V05a = {
  1: sil('额结节', '凸起', '侧后见鼻·额结节', null, 0.16, 0.26),
  2: sil('眉弓', '凸起', '眉弓', null, 0.26, 0.34),
  3: sil('鼻头', '凸起', '见鼻：鼻头进轮廓（须最高 z 前突）', null, 0.34, 0.44, { preferFront: true, preferFaceZ: true, minZ: 0.07 }),
  4:Object.assign(sil('口轮匝肌', '凸起', '口轮匝肌', null, 0.44, 0.52, { preferFront: true }),{preferBetween:true,between:['3','5'],betweenBias:0.4,betweenZNudge:0.008}),
  5:Object.assign(sil('颏结节', '凸起', '颏结节（勿落喉）', '喉、肩', 0.5, 0.58, { preferFront: true }),{preferBetween:true,between:['4','D'],betweenBias:0.55,betweenZNudge:0.01,betweenYNudge:-0.004}),
  A: sil('眉弓上缘', '凹陷', '眉弓上缘', null, 0.22, 0.3),
  B: sil('眼裂', '凹陷', '眼裂', null, 0.3, 0.4),
  C: sil('颊凹', '凹陷', '颊凹', null, 0.4, 0.5),
  D: sil('口轮匝肌下缘', '凹陷', '口轮匝肌下缘/颏唇沟水平', null, 0.5, 0.58),
  E: sil('颈点', '凹陷', '颈点', '肩', 0.58, 0.78, { allowBack: true, preferFaceZ: false })
};

const V05b = {
  1: sil('额结节', '凸起', '侧后隐鼻·额结节', null, 0.16, 0.26),
  2: sil('眉弓', '凸起', '眉峰上', null, 0.26, 0.34),
  3:Object.assign(sil('颧突隆', '凸起', '隐鼻：颧突隆代鼻头（勿标鼻）', '鼻头、鼻翼', 0.34, 0.44, { preferFaceZ: true, ignoreEar: true }),{preferBetween:true,between:['2','B'],betweenBias:0.7,betweenZNudge:0.015,betweenYNudge:-0.02}),
  4:Object.assign(sil('口轮匝肌', '凸起', '口轮匝肌', null, 0.44, 0.54, { preferFront: true }),{preferBetween:true,between:['3','5'],betweenBias:0.45,betweenZNudge:0.008}),
  5:Object.assign(sil('颏结节', '凸起', '颏结节', null, 0.5, 0.58, { preferFront: true }),{preferBetween:true,between:['4','D'],betweenBias:0.55,betweenZNudge:0.01,betweenYNudge:-0.004}),
  A: sil('眉弓上缘', '凹陷', '眉弓上缘', null, 0.22, 0.3),
  B: sil('眼裂', '凹陷', '眼裂', null, 0.3, 0.4),
  C: sil('颊凹', '凹陷', '颊凹', null, 0.4, 0.5),
  D: sil('口轮匝肌下缘', '凹陷', '口轮匝肌下缘', null, 0.5, 0.58),
  E: sil('颈点', '凹陷', '颈点', '肩', 0.58, 0.78, { allowBack: true, preferFaceZ: false })
};

const V06 = {
  1: {
    name: '颅顶点',
    kind: '凸起',
    where: '背面颅盖最高',
    forbid: '肩',
    band: { v0: 0.1, v1: 0.24, side: 'apexHighest' }
  },
  2: {
    name: '脑颅侧方最宽点',
    kind: '凸起',
    where: '背面脑颅最宽（一侧）',
    forbid: '耳壳、肩',
    band: { v0: 0.22, v1: 0.4, side: 'left', allowBack: true, preferWidest: true }
  },
  3: {
    name: '下颌角后缘',
    kind: '凸起',
    where: '下颌角后缘',
    forbid: '肩',
    band: { v0: 0.42, v1: 0.55, side: 'silLeft', allowBack: true }
  },
  4: {
    name: '胸锁乳突肌后缘',
    kind: '凸起',
    where: '胸锁后缘',
    forbid: '肩峰',
    band: { v0: 0.52, v1: 0.68, side: 'silLeft', allowBack: true }
  }
};

const V07 = {
  1: {
    name: '鼻头',
    kind: '凸起',
    where: '顶视最前鼻头',
    forbid: '眉',
    band: { v0: 0.55, v1: 0.75, side: 'topFront' }
  },
  2: {
    name: '眉弓',
    kind: '凸起',
    where: '顶视前额/眉弓整段前缘',
    forbid: null,
    band: { v0: 0.45, v1: 0.6, side: 'topFront' }
  },
  3: {
    name: '颧骨弓隆起',
    kind: '凸起',
    where: '顶视前半最宽（颧弓）',
    forbid: '耳',
    band: { v0: 0.35, v1: 0.55, side: 'topWidest', zone: 'front' }
  },
  4: {
    name: '脑颅侧方最宽点',
    kind: '凸起',
    where: '顶视后半最宽（颅侧）',
    forbid: '耳',
    band: { v0: 0.25, v1: 0.45, side: 'topWidest', zone: 'back' }
  },
  5: {
    name: '枕后突隆',
    kind: '凸起',
    where: '顶视最后枕后',
    forbid: null,
    band: { v0: 0.15, v1: 0.35, side: 'topBack' }
  }
};

/** L05 正前光头侧交界 ≈ V02 W + 颞线支线 */
const L05 = {
  1: Object.assign({}, V02[1], { name: '颅顶点' }),
  2: {
    name: '脑颅侧方最宽点',
    kind: '凸起',
    where: '头侧后颅宽（正前光头侧）',
    forbid: '耳壳',
    band: { v0: 0.2, v1: 0.34, side: 'left', allowBack: true, preferWidest: true, preferFaceZ: false }
  },
  3: {
    name: '颧骨弓隆起',
    kind: '凸起',
    where: '耳前颧弓最外（勿钉耳廓）',
    forbid: '耳轮、耳垂',
    pickHint: '前脸最左缘',
    band: { v0: 0.34, v1: 0.44, side: 'left', ignoreEar: true, preferFaceZ: true, minZ: 0.022, maxZ: 0.055 }
  },
  4: {
    name: '颧突隆',
    kind: '凸起',
    where: '颧突隆（交界经过）',
    forbid: '耳',
    band: { v0: 0.4, v1: 0.5, side: 'left', preferFaceZ: true, ignoreEar: true, minZ: 0.03, maxZ: 0.06 }
  },
  5: Object.assign({}, V02[4], {
    forbid: '耳、颈',
    preferBetween: true,
    between: ['4', '6'],
    betweenBias: 0.4,
    betweenZNudge: 0.006,
    betweenXNudge: -0.002,
    betweenYNudge: -0.004
  }),
  6: {
    name: '颏结节',
    kind: '凸起',
    where: '颏结节（交界经过）',
    forbid: '颈前、肩',
    pickHint: '颏左前突',
    band: { v0: 0.5, v1: 0.62, side: 'chinL' },
    preferBetween: true,
    between: ['4', '4'],
    betweenBias: 0,
    betweenYNudge: -0.055,
    betweenZNudge: 0.03,
    betweenXNudge: 0.025,
    betweenMinDist: 0.016
  },
  7: {
    name: '颞线',
    kind: '交界点',
    where: '颞线交界（前脸，勿钉耳）',
    forbid: '耳',
    band: { v0: 0.2, v1: 0.3, side: 'left', preferFaceZ: true, ignoreEar: true, allowBack: false, minZ: 0.028, maxZ: 0.06 }
  },
  8: {
    name: '眉峰',
    kind: '交界点',
    where: '眉峰/眶外上',
    forbid: '耳',
    band: { v0: 0.28, v1: 0.36, side: 'left', preferFaceZ: true, ignoreEar: true, minZ: 0.04, maxZ: 0.07 }
  },
  9: {
    name: '眶外角',
    kind: '交界点',
    where: '眶外角下颧上',
    forbid: '耳',
    band: { v0: 0.34, v1: 0.42, side: 'left', preferFaceZ: true, ignoreEar: true, minZ: 0.03, maxZ: 0.06 }
  }
};


function Lpt(name,kind,where,v0,v1,extra){
  return {name,kind,where,forbid:'耳壳外缘(除非本点就是耳)、肩',band:Object.assign({v0,v1,side:'silLeft',preferFaceZ:true},extra||{})};
}
const L01={
  1:Lpt('颞线','交界点','颞线（前脸侧，勿钉耳）',0.2,0.3,{preferFaceZ:true,ignoreEar:true,allowBack:false,minZ:0.04,side:'left'}),
  2:Lpt('眉峰','交界点','眉峰',0.28,0.36,{preferFaceZ:true,ignoreEar:true,minZ:0.045,side:'left'}),
  3:Lpt('眶外角','交界点','眶外角',0.34,0.42,{preferFaceZ:true,ignoreEar:true,minZ:0.04,side:'left'}),
  4:Lpt('颧突隆','交界点','颧突隆',0.4,0.5,{preferFaceZ:true,ignoreEar:true,minZ:0.038,side:'left'}),
  5:Lpt('颊凹','交界点','颊凹',0.44,0.52,{preferFaceZ:true,minZ:0.03,side:'left'}),
  6:Lpt('口轮匝肌侧缘','交界点','口轮匝肌侧缘',0.48,0.56,{preferFaceZ:true,preferFront:true,side:'left'}),
  7:Object.assign(Lpt('角前切迹','交界点','角前切迹',0.5,0.58,{jawFace:true,side:'left'}),{preferBetween:true,between:['6','8'],betweenBias:0.45,betweenZNudge:0.008,betweenXNudge:-0.006}),
  8:Lpt('颏结节','交界点','颏结节',0.52,0.6,{side:'chinL'}),
  9:Lpt('颏底','交界点','颏底',0.54,0.64,{side:'chinC'}),
  A:Lpt('眼睑交界','交界点','上下眼睑交界（前脸，勿钉耳垂）',0.34,0.42,{preferFaceZ:true,ignoreEar:true,minZ:0.045,side:'left'}),
  B:Lpt('眉头→鼻底','交界点','眉头到鼻底交界',0.32,0.48,{preferFront:true,preferFaceZ:true,minZ:0.05,side:'left'})
};
const L02={
  1:Lpt('额结节交界','交界点','额区交界起点',0.18,0.28),
  2:Lpt('眉','交界点','眉',0.28,0.36),
  3:Lpt('鼻','交界点','鼻侧交界',0.34,0.44,{preferFront:true}),
  4:Lpt('口','交界点','口周交界',0.44,0.52,{preferFront:true}),
  5:Lpt('颏','交界点','颏交界',0.5,0.58,{preferFront:true}),
  6:Lpt('颧','交界点','颧交界',0.38,0.48),
  7:Lpt('颊','交界点','颊交界',0.42,0.52),
  8:Lpt('下颌','交界点','下颌交界',0.48,0.58),
  9:Lpt('颏底侧','交界点','颏底侧',0.52,0.62),
  10:Lpt('鼻侧接颊','交界点','鼻侧接到颊',0.36,0.46,{preferFront:true}),
  11:Lpt('颏前','交界点','颏前',0.52,0.6,{preferFront:true}),
  '伦勃朗三角':{name:'伦勃朗三角',kind:'现象区',where:'暗颊三角亮区中心',forbid:'鼻翼本身',band:{v0:0.36,v1:0.5,side:'silLeft',preferFaceZ:true}}
};
const L03={
  1:Lpt('眉弓交界','交界段','眉弓交界段',0.28,0.36),
  2:Lpt('下眼睑','交界段','下眼睑',0.34,0.42),
  3:Lpt('鼻底侧','交界段','鼻底/侧',0.36,0.46,{preferFront:true}),
  4:Lpt('上唇上缘','交界段','上唇与嘴角上缘',0.44,0.52,{preferFront:true}),
  5:Lpt('颏唇沟','交界段','颏唇沟上缘',0.48,0.56,{preferFront:true}),
  6:Lpt('下巴下缘','交界段','下巴下缘偏上',0.52,0.62,{preferFront:true}),
  7:Lpt('颧骨上','交界段','颧骨上',0.36,0.46),
  8:Lpt('脸颊上','交界段','脸颊上/颊凹下缘',0.42,0.52)
};
const L04={
  1:Lpt('额','交界点','额交界',0.18,0.28),
  2:Lpt('眉','交界点','眉',0.28,0.36),
  3:Lpt('睑','交界点','睑',0.34,0.42),
  4:Lpt('鼻','交界点','鼻',0.36,0.46,{preferFront:true}),
  5:Lpt('口','交界点','口',0.44,0.54,{preferFront:true}),
  6:Lpt('颏','交界点','颏',0.5,0.6,{preferFront:true}),
  7:Lpt('颧','交界点','颧',0.38,0.48),
  8:Lpt('颊','交界点','颊',0.42,0.52),
  9:Lpt('下颌','交界点','下颌',0.48,0.58),
  10:Lpt('颏结节','交界点','颏结节',0.52,0.6,{side:'chinL'}),
  11:Lpt('颏底','交界点','颏底',0.54,0.64,{side:'chinC'}),
  12:Lpt('颈侧','交界点','颈侧',0.58,0.7,{allowBack:true,preferFaceZ:false}),
  13:Lpt('耳前','交界点','耳前交界',0.36,0.48,{allowBack:true}),
  A:Lpt('上睑','交界点','上睑支线',0.32,0.4),
  B:Lpt('下睑','交界点','下睑支线',0.36,0.44)
};
const L06={
  1:Lpt('眉弓','交界段','顶前·眉弓',0.28,0.36),
  2:Lpt('颧骨上','交界段','颧骨上',0.34,0.44),
  3:Lpt('鼻底','交界段','鼻底',0.38,0.48,{preferFront:true}),
  4:Lpt('上唇白脊上','交界段','上唇白脊上',0.44,0.52,{preferFront:true}),
  5:Lpt('下唇白脊','交界段','下唇白脊',0.48,0.56,{preferFront:true}),
  6:Lpt('下巴前缘','交界段','下巴前缘',0.52,0.62,{preferFront:true}),
  7:Lpt('鼻唇沟','交界段','鼻唇沟',0.4,0.52,{preferFront:true})
};
const L07={
  1:Lpt('眉弓下','交界点','眶窝/眉弓下',0.3,0.4),
  2:Lpt('颧→鼻唇沟','交界点','颧到鼻唇沟',0.38,0.5),
  3:Lpt('鼻底','交界点','鼻底',0.4,0.5,{preferFront:true}),
  4:Lpt('上唇嘴角','交界点','上唇与嘴角',0.44,0.54,{preferFront:true}),
  5:Lpt('下唇白脊','交界点','下唇白脊',0.48,0.56,{preferFront:true}),
  6:Lpt('颏前缘','交界点','颏前缘',0.5,0.6,{preferFront:true}),
  7:Lpt('鼻唇沟','交界点','鼻唇沟',0.42,0.52,{preferFront:true}),
  8:Object.assign(Lpt('颊侧下颌底','交界点','颊侧到下颌底',0.5,0.64,{jawFace:true,side:'left'}),{between:['5','6'],betweenBias:0.9,betweenZNudge:0,betweenXNudge:-0.018,betweenYNudge:-0.018})
};
const L08={
  1:Lpt('颞线','交界点','颞线',0.2,0.3,{allowBack:true,preferFaceZ:false}),
  2:Lpt('眉峰','交界点','眉峰',0.28,0.36),
  3:Lpt('眶外角','交界点','眶外角',0.34,0.42),
  4:Lpt('颧突隆','交界点','颧突隆',0.4,0.5),
  5:Lpt('咬肌','交界点','咬肌',0.44,0.54),
  6:{name:'咬肌前切迹',kind:'交界点',where:'咬肌前切迹（5与7之间颊侧）',forbid:'颈肩、喉、颏下',band:{v0:0.44,v1:0.52,side:'left',jawFace:true},between:['5','7'],betweenBias:0.32,betweenZNudge:0.002,betweenXNudge:-0.004,betweenYNudge:0.004},
  7:Lpt('颏转角','交界点','颏转角',0.52,0.62),
  8:Lpt('胸锁乳突肌','交界点','胸锁乳突肌',0.55,0.7,{allowBack:true,preferFaceZ:false})
};
const L09={
  1:{name:'颅顶点',kind:'交界点',where:'颅顶亮边',forbid:'肩',band:{v0:0.1,v1:0.24,side:'apexHighest'}},
  // 相机在 +X：后脑/耳后在画面右缘 → silRight + requireBack
  2:{name:'脑颅侧方最宽',kind:'交界点',where:'颅侧后最宽',forbid:'耳壳、面中',band:{v0:0.16,v1:0.34,side:'silRight',allowBack:true,requireBack:true}},
  3:{name:'耳朵',kind:'交界点',where:'耳廓后缘（本课可标耳）',forbid:'面中、肩',band:{v0:0.3,v1:0.46,side:'silRight',allowBack:true,requireBack:true}},
  4:{name:'乳突',kind:'交界点',where:'耳后乳突',forbid:'面中、肩',band:{v0:0.38,v1:0.52,side:'silRight',allowBack:true,requireBack:true},preferBetween:true,between:['3','5'],betweenBias:0.45,betweenZNudge:-0.015},
  5:{name:'胸锁后缘',kind:'交界点',where:'胸锁乳突肌后缘',forbid:'面中',band:{v0:0.48,v1:0.66,side:'silRight',allowBack:true,requireBack:true}},
  6:{name:'下颌',kind:'交界点',where:'下颌角后',forbid:'颏前',band:{v0:0.44,v1:0.56,side:'silRight',allowBack:true,requireBack:true}},
  A:{name:'颌后沟',kind:'交界点',where:'颌后沟',forbid:'颏前',band:{v0:0.42,v1:0.54,side:'silRight',allowBack:true,requireBack:true}},
  B:{name:'下颌亮面',kind:'交界点',where:'下颌侧亮面（可略前）',forbid:null,band:{v0:0.46,v1:0.58,side:'left',preferFaceZ:true}}
};

const SLOT_CARDS = {
  V01,
  V02,
  V03,
  V04,
  V05a,
  V05A: V05a,
  V05b,
  V05B: V05b,
  V06,
  V07,
  L01,
  L02,
  L03,
  L04,
  L05,
  L06,
  L07,
  L08,
  L09
};

function normalizeSlot(slot) {
  const s = String(slot || '');
  if (/^V05a$/i.test(s)) return 'V05a';
  if (/^V05b$/i.test(s)) return 'V05b';
  return s;
}

function getCard(slot, landmark) {
  const s = normalizeSlot(slot);
  const pack = SLOT_CARDS[s];
  if (!pack) return null;
  return pack[String(landmark)] || pack[landmark] || null;
}

function listLandmarks(slot) {
  const s = normalizeSlot(slot);
  const pack = SLOT_CARDS[s];
  if (!pack) return [];
  // 显式顺序：避免 Object.keys 把数字键排成 1,2,3,4,5… 打乱邻点依赖链
  const ORDER = {
    V01: ['1', '2', '3', 'A', 'B', '5', '4', 'C', 'D'],
    L05: ['1', '2', '7', '8', '9', '3', '4', '6', '5'],
    L01: ['1', '2', '3', '4', '5', '6', '8', '7', '9', 'A', 'B']
  };
  if (ORDER[s]) return ORDER[s].filter((k) => pack[k] != null);
  return Object.keys(pack);
}

module.exports = { SLOT_CARDS, V02_CARDS: V02, getCard, listLandmarks, normalizeSlot };

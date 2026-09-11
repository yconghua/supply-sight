/**
 * 主数据生成（数据模拟器）
 *
 * 产出两类主数据：供应商 12 家、物料 60 个（数量可由调用方指定）。
 * 每个对象同时带两类字段：
 *   1. 入库字段——会写进 supplier / material 表（编码、名称、订货点、MOQ 等）；
 *   2. 模拟参数——只参与推演、不入库（延迟均值、需求波动、价格漂移等）。
 *      刻意不入库是为了让 business 表保持干净的业务语义，模拟假设统一记在 sim_run.profile。
 *
 * 主动埋点（本文件的核心价值）：
 *   模拟器不是「随便造点数据」，而是「造出有故事、且故事能被规则命中的数据」。
 *   因此这里故意安排三处异常，让三个业务问题都有数据支撑的答案：
 *     - 2 家供应商延迟均值与波动都明显偏大、不良率偏高 → 必然命中「供应商不靠谱」；
 *     - 3~5 个物料需求低但最小起订量很高 → 必然形成呆滞库存、压住资金；
 *     - 3 个物料的采购价带正向漂移 → 必然命中「成本降不下来」。
 *   埋点结果全部记进 profile 返回，写入 sim_run.profile，演示时可以直接回答
 *   「这个坑是故意埋的还是碰巧出来的」。
 */
const { randInt, randFloat, pickOne, clamp, round2, round4 } = require('./prng')

// ===== 命名素材 =====

// 供应商类别：不同类别供应不同物料，保证「物料的供应商与其类别匹配」这一业务常识
const SUPPLIER_CATEGORIES = ['原料', '辅料', '包材', '外协']
// 属地前缀（湖南本地，贴合中小制造企业供应链场景）
const SUPPLIER_PREFIX = ['长沙', '株洲', '湘潭', '岳阳', '衡阳', '常德', '郴州', '益阳', '娄底', '邵阳', '永州', '怀化']
// 商号中缀
const SUPPLIER_MIDDLE = ['宏远', '鑫盛', '恒达', '瑞泰', '金诚', '博纳', '联创', '华信', '正大', '天成', '力和', '广源']
// 类别对应的企业后缀
const SUPPLIER_SUFFIX = {
  原料: '金属材料有限公司',
  辅料: '精密机械有限公司',
  包材: '包装制品有限公司',
  外协: '机电设备有限公司'
}
// 联系人姓氏与名字用字
const CONTACT_SURNAME = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙']
const CONTACT_GIVEN = ['伟', '强', '磊', '静', '敏', '涛', '鹏', '娟', '刚', '丽', '军', '霞']

// 物料类别与其词根（按类别组织，便于与供应商类别对应）
const MATERIAL_BASE = {
  原料: ['冷轧钢板', '铝型材', '紫铜线', 'ABS塑料粒', 'PP塑料粒', '不锈钢管', '铸铁件', '橡胶原料', '环氧树脂', '玻璃纤维'],
  辅料: ['内六角螺栓', '平垫圈', '压缩弹簧', '深沟球轴承', 'O型密封圈', '轴用卡簧', '圆柱定位销', '锂基润滑脂', '无铅焊锡丝', '尼龙扎带'],
  包材: ['瓦楞纸箱', 'EPE珍珠棉', 'PE缠绕膜', '不干胶标签', '实木托盘', '气泡缓冲袋', 'PP打包带', '气相防锈纸'],
  备件: ['三相异步电机', '标准气缸', '接近传感器', '同步传动带', '行星减速机', '通用变频器', '二位电磁阀', '立式轴承座']
}
// 物料类别对应计量单位
const MATERIAL_UNIT = { 原料: 'kg', 辅料: '个', 包材: '个', 备件: '台' }
// 规格序数，用于同词根物料区分
const MATERIAL_SPEC = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ']

/**
 * 生成供应商主数据。
 * @param {Function} random 均匀随机源
 * @param {Function} normal 正态分布采样
 * @param {number} count 供应商数量
 * @returns {{ list: Object[], badIndexes: number[] }}
 *          list 元素含入库字段 + 模拟参数；badIndexes 是被埋成「不靠谱」的供应商下标
 */
function generateSuppliers(random, normal, count) {
  // 先决定哪几家是「不靠谱」的：12 家里挑 2 家，比例约 17%，符合「少数供应商拉低整体表现」的现实
  const badCount = Math.max(1, Math.round(count / 6))
  const badIndexes = []
  while (badIndexes.length < badCount && badIndexes.length < count) {
    const idx = randInt(random, 0, count - 1)
    if (!badIndexes.includes(idx)) badIndexes.push(idx)
  }

  const list = []
  for (let i = 0; i < count; i++) {
    const category = SUPPLIER_CATEGORIES[i % SUPPLIER_CATEGORIES.length]
    const isBad = badIndexes.includes(i)
    // 延迟均值：相对承诺交期的平均偏差（负数表示习惯提前），单位为天。
    // 这里的关键是让「正常」与「埋点」在 OTD 上分得开，而不是连成一片灰色地带：
    //   OTD = P(延迟 ≤ 0) = P(N(μ, σ) ≤ 0)，真正决定准时率的是 μ / σ 的比值，不是 μ 本身。
    //   正常供应商 μ/σ ≈ -1.5 → 准时率约 93% ~ 96%，稳定高于 90% 的预警线；
    //   埋点供应商 μ/σ ≈ +1.0 以上 → 准时率跌到 10% ~ 20%，必然被规则命中。
    const delayMean = isBad
      ? round2(randFloat(random, 2.5, 4))
      : round2(randFloat(random, -2.0, -1.3))
    // 延迟波动：埋点供应商交期极不稳定，这是「不靠谱」的第二个特征
    const delayStd = isBad
      ? round2(randFloat(random, 2.0, 3.0))
      : round2(randFloat(random, 0.8, 1.2))
    // 不良率均值：正常 0.1% ~ 0.4%（PPM 1000 ~ 4000，稳定低于 5000 的预警线），
    // 埋点 1.5% ~ 3%（PPM 15000 ~ 30000，必然越过预警线）。
    // 上界刻意压到 0.4%：若放到 0.6%，正常供应商会贴着 5000 的阈值来回擦边，
    // 造成大量误报，「哪家不靠谱」反而说不清楚。
    const defectRateMean = round4(isBad
      ? randFloat(random, 0.015, 0.03)
      : randFloat(random, 0.001, 0.004))
    // 不良率波动
    const defectRateStd = round4(defectRateMean * randFloat(random, 0.3, 0.6))

    const prefix = SUPPLIER_PREFIX[i % SUPPLIER_PREFIX.length]
    const middle = pickOne(random, SUPPLIER_MIDDLE)
    list.push({
      // ---- 入库存字段 ----
      code: `SUP${String(i + 1).padStart(3, '0')}`,
      name: `${prefix}${middle}${SUPPLIER_SUFFIX[category]}`,
      category,
      contact_person: `${pickOne(random, CONTACT_SURNAME)}${pickOne(random, CONTACT_GIVEN)}`,
      phone: `13${randInt(random, 0, 9)}${String(randInt(random, 0, 99999999)).padStart(8, '0')}`.slice(0, 11),
      credit_level: isBad ? 'C' : pickOne(random, ['A', 'A', 'B', 'B', 'B']),
      payment_days: pickOne(random, [30, 30, 45, 60, 90]),
      status: 'active',
      // ---- 仅参与推演的模拟参数（不入库）----
      isBad,
      delayMean,
      delayStd,
      defectRateMean,
      defectRateStd
    })
  }
  return { list, badIndexes }
}

/**
 * 生成物料主数据。
 * 需求与单价都用「对数均匀分布」取值：这样取值会自然呈现出
 * 「少数物料占大头、多数物料占小头」的长尾形态，
 * 后续按年消耗金额做 ABC 分类时才能得到真实的 80/15/5 帕累托结构
 * （而不是预先拍脑袋指定谁是 A 类）。
 * @param {Function} random 均匀随机源
 * @param {Function} normal 正态分布采样
 * @param {number} count 物料数量
 * @param {Object[]} suppliers 供应商列表（用于分配主供应商）
 * @returns {{ list: Object[], slowIndexes: number[], driftIndexes: number[] }}
 */
function generateMaterials(random, normal, count, suppliers) {
  // 埋点：挑出「慢动积压」与「价格漂移」两类物料的下标
  const slowCount = clamp(Math.round(count * 0.07), 3, 5) // 60 个物料里挑 4 个左右
  const driftCount = clamp(Math.round(count * 0.05), 2, 3)

  const pickDistinctIndexes = (n) => {
    const picked = []
    while (picked.length < n && picked.length < count) {
      const idx = randInt(random, 0, count - 1)
      if (!picked.includes(idx)) picked.push(idx)
    }
    return picked
  }
  const slowIndexes = pickDistinctIndexes(slowCount)
  const driftIndexes = pickDistinctIndexes(driftCount).filter((i) => !slowIndexes.includes(i))

  // 按类别分组供应商，保证物料的供应商类别与物料类别一致
  const suppliersByCategory = {}
  for (const s of suppliers) {
    if (!suppliersByCategory[s.category]) suppliersByCategory[s.category] = []
    suppliersByCategory[s.category].push(s)
  }
  // 每个类别内部的轮询游标，让同一供应商承接多个物料
  const cursorByCategory = {}
  // 每个词根已用次数，用于分配规格序数避免重名
  const baseUsedCount = {}

  const list = []
  for (let i = 0; i < count; i++) {
    const category = Object.keys(MATERIAL_BASE)[i % Object.keys(MATERIAL_BASE).length]
    const bases = MATERIAL_BASE[category]
    const base = bases[Math.floor(i / Object.keys(MATERIAL_BASE).length) % bases.length]
    // 同一词根第二次出现时换一个规格序数，保证名称不重复
    const used = baseUsedCount[base] || 0
    baseUsedCount[base] = used + 1
    const spec = MATERIAL_SPEC[used % MATERIAL_SPEC.length]

    const isSlow = slowIndexes.includes(i)
    const isDrift = driftIndexes.includes(i)

    // 日均需求：对数均匀分布取 2 ~ 300。
    // 慢动物料的呆滞不靠「需求极低」，而靠下面两件事，更贴近现实：
    //   1) 被抬高的最小起订量——一次进货就够用大半年；
    //   2) demandStopDay 之后需求彻底归零——模拟产品停产、备件不再领用。
    // 后者是真实呆滞库存最常见的成因，也让「近 N 天无出库」这个判断条件稳定成立。
    const dailyDemand = isSlow
      ? round2(randFloat(random, 0.5, 2))
      : round2(Math.exp(randFloat(random, Math.log(2), Math.log(300))))

    // 标准单价：对数均匀分布取 1 ~ 500 元
    const stdPrice = round4(Math.exp(randFloat(random, Math.log(1), Math.log(500))))

    // 采购提前期：7 ~ 30 天
    const leadTimeDays = randInt(random, 7, 30)

    // 需求波动系数（日需求的标准差比例）
    const demandSigma = round2(randFloat(random, 0.12, 0.3))

    // 安全库存：按「服务水平系数 × 需求标准差 × √提前期」计算（标准库存公式，1.65 对应 95% 服务水平）
    const dailyStd = dailyDemand * demandSigma
    const safetyStock = Math.max(0, round2(1.65 * dailyStd * Math.sqrt(leadTimeDays)))
    // 订货点：提前期内的平均需求 + 安全库存（同样是最标准的定义）
    const reorderPoint = round2(dailyDemand * leadTimeDays + safetyStock)

    // 最小起订量：
    //   正常物料约为月需求的 1/4（贴合供应商的批量要求）；
    //   慢动物料故意给到月需求的 2.5 倍以上，这是它必然形成呆滞的直接原因。
    const monthlyDemand = dailyDemand * 30
    const moq = isSlow
      // 慢动物料：一次进货是月需求的 3~8 倍，停产时必然剩下一批库存压着资金
      ? Math.max(10, Math.round((monthlyDemand * randFloat(random, 3, 8)) / 10) * 10)
      : Math.max(10, Math.round((monthlyDemand * 0.25) / 10) * 10)

    // 价格波动率（每单价格的随机游走标准差）。
    // 埋点物料刻意压低波动：随机波动一旦盖过漂移，「持续上涨」就会被噪声淹没，
    // 趋势型预警永远命不中，埋点也就白埋了。
    const priceVolatility = isDrift
      ? round4(randFloat(random, 0.004, 0.01))
      : round4(randFloat(random, 0.01, 0.03))
    // 价格漂移：埋点物料每下一单涨价约 1.2% ~ 2%，累计形成明显的成本上行趋势
    const priceDrift = isDrift ? round4(randFloat(random, 0.012, 0.02)) : 0

    // 分配主供应商：从同类别供应商里轮询挑选
    const pool = suppliersByCategory[category] && suppliersByCategory[category].length
      ? suppliersByCategory[category]
      : suppliers
    cursorByCategory[category] = (cursorByCategory[category] || 0)
    const supplier = pool[cursorByCategory[category] % pool.length]
    cursorByCategory[category] += 1

    list.push({
      // ---- 入库存字段 ----
      code: `MAT${String(i + 1).padStart(3, '0')}`,
      name: `${base}${spec}`,
      category,
      unit: MATERIAL_UNIT[category],
      // ABC 分类此时还不知道：它依赖年消耗金额，必须等推演出流水后才能回填
      abc_class: 'C',
      std_price: stdPrice,
      safety_stock: safetyStock,
      reorder_point: reorderPoint,
      moq,
      lead_time_days: leadTimeDays,
      status: 'active',
      // ---- 仅参与推演的模拟参数（不入库）----
      dailyDemand,
      demandSigma,
      seasonAmp: round2(randFloat(random, 0.1, 0.35)),
      seasonPhase: round2(randFloat(random, 0, Math.PI * 2)),
      priceVolatility,
      priceDrift,
      primarySupplierCode: supplier.code,
      // 停产日：从推演第几天起该物料不再有领用需求（0 表示全期都有需求）
      demandStopDay: isSlow ? randInt(random, 200, 450) : 0,
      isSlow,
      isDrift
    })
  }
  return { list, slowIndexes, driftIndexes }
}

/**
 * 生成全部主数据，并汇总埋点信息。
 * @param {{ random: Function, normal: Function, materialCount: number, supplierCount: number }} options
 * @returns {{ suppliers: Object[], materials: Object[], profile: Object }}
 */
function generateMasterData({ random, normal, materialCount, supplierCount }) {
  const supplierResult = generateSuppliers(random, normal, supplierCount)
  const materialResult = generateMaterials(random, normal, materialCount, supplierResult.list)

  // 埋点档案：写进 sim_run.profile，让「故意造的坑」有据可查
  const profile = {
    badSuppliers: supplierResult.list
      .filter((s) => s.isBad)
      .map((s) => ({
        code: s.code,
        name: s.name,
        delayMean: s.delayMean,
        delayStd: s.delayStd,
        defectRateMean: s.defectRateMean,
        reason: '交付延迟均值与波动明显偏大、来料不良率偏高，用于验证供应商绩效预警'
      })),
    slowMaterials: materialResult.list
      .filter((m) => m.isSlow)
      .map((m) => ({
        code: m.code,
        name: m.name,
        dailyDemand: m.dailyDemand,
        moq: m.moq,
        stopDay: m.demandStopDay,
        reason: '模拟产品停产后备件不再领用：起订量偏大导致停产后仍积压一批库存，用于验证呆滞库存预警'
      })),
    priceDriftMaterials: materialResult.list
      .filter((m) => m.isDrift)
      .map((m) => ({
        code: m.code,
        name: m.name,
        driftPerOrder: m.priceDrift,
        reason: '采购单价按下单批次持续上浮，用于验证采购成本上涨预警'
      }))
  }

  return { suppliers: supplierResult.list, materials: materialResult.list, profile }
}

module.exports = { generateMasterData }

/**
 * 勾稽自检编排（数据模拟器）
 *
 * 生成结束后跑 5 项自检，结果写进 sim_run.selfcheck 并在模拟器页面直接展示。
 * 把校验结果摊在页面上，是为了让「数据是平的」这件事可被当场验证，
 * 而不是靠一句「数据是模拟的、应该没问题」。
 *
 * 5 项自检：
 *   1~4 由 SQL 直接核对已落库的数据（见 verifyQueries.js），任何一项不平都说明推演有漏洞；
 *   5   PRNG 确定性校验——同一种子实例化两次，前 100 个随机数必须逐一相等。
 *
 * 另外计算一份「数据指纹」：把规模、时间范围与各表条数、金额汇总哈希成一个短串。
 * 指纹本身不判定通过与否，但它记录在案，用同一种子再生成一次即可人工比对是否复现。
 */
const { createRandom } = require('./prng')
const {
  countSnapshotUnbalanced,
  countNegativeEndStock,
  countSnapshotAmountMismatch,
  countOrderInboundMismatch
} = require('../../db/repositories/verifyQueries')

/**
 * FNV-1a 字符串哈希，输出 8 位十六进制。
 * 选它是因为实现短、分布均匀，且不需要引入任何依赖。
 * @param {string} text 待哈希文本
 * @returns {string} 8 位十六进制哈希
 */
function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    // Math.imul 保证按 32 位整数溢出，与 C 语言版 FNV 行为一致
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 计算本次生成的数据指纹。
 * 覆盖规模、时间范围、各表条数与金额汇总——任何一项变化都会改变指纹。
 * @param {Object} input 含 seed / materialCount / supplierCount / startDate / endDate / stats
 * @returns {string} 数据指纹
 */
function computeFingerprint({ seed, materialCount, supplierCount, startDate, endDate, stats }) {
  const parts = [
    seed,
    materialCount,
    supplierCount,
    startDate,
    endDate,
    stats.orderCount,
    stats.flowCount,
    stats.snapshotCount,
    stats.orderAmount,
    stats.flowAmount,
    stats.snapshotAmount
  ]
  return fnv1a(parts.join('|'))
}

/**
 * 校验随机数生成器的确定性：同种子两次实例化的序列必须完全一致。
 * 这是「同种子可复现」这个承诺的技术底座——只要它成立，
 * 且调用随机源的顺序固定，整个推演过程就是可复现的。
 * @param {number} seed 随机种子
 * @returns {boolean} 两条序列是否一致
 */
function checkPrngDeterminism(seed) {
  const first = createRandom(seed)
  const second = createRandom(seed)
  for (let i = 0; i < 100; i++) {
    if (first() !== second()) return false
  }
  return true
}

/**
 * 执行全部自检。
 * @param {Object} options
 * @param {number} options.seed 本次随机种子
 * @param {string} options.fingerprint 本次数据指纹
 * @param {Object|null} [options.previousRun] 最近一次同种子的成功记录（用于指纹比对）
 * @returns {Promise<{ items: Object[], passed: boolean, fingerprint: string, fingerprintMatched: boolean|null }>}
 */
async function runSelfCheck({ seed, fingerprint, previousRun = null }) {
  // 四项库级勾稽并行查询，缩短等待
  const [unbalanced, negative, amountMismatch, inboundMismatch] = await Promise.all([
    countSnapshotUnbalanced(),
    countNegativeEndStock(),
    countSnapshotAmountMismatch(),
    countOrderInboundMismatch()
  ])

  // 指纹比对：有同种子历史记录时给出明确的「一致 / 不一致」结论
  let fingerprintMatched = null
  let reproducibleDetail = `本次数据指纹 ${fingerprint}（已记录，用同一种子再生成一次即可比对）`
  if (previousRun && previousRun.selfcheck) {
    const previousFingerprint = previousRun.selfcheck.fingerprint
    if (previousFingerprint) {
      fingerprintMatched = previousFingerprint === fingerprint
      reproducibleDetail = fingerprintMatched
        ? `与上次同种子生成（${previousRun.run_no}）指纹一致：${fingerprint}`
        : `本次指纹 ${fingerprint}，上次同种子生成（${previousRun.run_no}）为 ${previousFingerprint}，两者不一致`
    }
  }
  // 历史指纹存在时，以指纹比对结果为准；否则以 PRNG 确定性校验为准
  const prngOk = checkPrngDeterminism(seed)
  const reproduciblePassed = fingerprintMatched === null ? prngOk : (prngOk && fingerprintMatched)

  const items = [
    {
      key: 'snapshot_balance',
      name: '库存快照勾稽：期初 + 入库 − 出库 = 期末',
      passed: unbalanced === 0,
      detail: unbalanced === 0 ? '全部账期平衡' : `${unbalanced} 条快照不平`
    },
    {
      key: 'negative_stock',
      name: '期末库存不为负',
      passed: negative === 0,
      detail: negative === 0 ? '无负库存' : `${negative} 条期末数量为负`
    },
    {
      key: 'snapshot_amount',
      name: '库存金额 = 期末数量 × 期末单价',
      passed: amountMismatch === 0,
      detail: amountMismatch === 0 ? '金额与数量单价一致' : `${amountMismatch} 条金额对不上`
    },
    {
      key: 'order_inbound',
      name: '订单合格数量 = 对应入库数量',
      passed: inboundMismatch === 0,
      detail: inboundMismatch === 0 ? '订单与入库流水完全对应' : `${inboundMismatch} 张订单与入库量不匹配`
    },
    {
      key: 'reproducible',
      name: '同种子可复现',
      passed: reproduciblePassed,
      detail: prngOk ? reproducibleDetail : '随机数生成器确定性校验未通过'
    }
  ]

  return {
    items,
    passed: items.every((item) => item.passed),
    fingerprint,
    fingerprintMatched
  }
}

module.exports = { runSelfCheck, computeFingerprint, checkPrngDeterminism, fnv1a }

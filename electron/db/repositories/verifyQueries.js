/**
 * 勾稽校验查询（Repository Layer）
 *
 * 数据模拟器生成完成后，用一组 SQL 直接对「已落库的数据」做勾稽核对，
 * 而不是只信内存里的推演结果——落库后仍然平，才说明数据真的可用。
 *
 * 每个函数统一返回「违规条数」：0 表示这一项通过。
 * 之所以叫违规条数而不是布尔值，是为了让页面能显示「有多少条不平」，
 * 排查问题时比一个 false 有用得多。
 *
 * 全部使用 query（文本协议）而非 execute：这些语句含子查询与聚合，
 * 在部分 MySQL 版本上用预处理协议对 information_schema / 派生表支持不稳定。
 */
const { acquireConn } = require('../connection')

/**
 * 执行一条「返回单个计数值」的查询。
 * @param {string} sql 查询语句（不含分号）
 * @param {Array} [params] 占位符参数
 * @returns {Promise<number>} 计数值
 */
async function countQuery(sql, params = []) {
  const { conn, release } = await acquireConn()
  try {
    const [rows] = await conn.query(sql, params)
    if (!rows || !rows.length) return 0
    // 取第一列的值，避免依赖具体别名大小写
    const first = Object.values(rows[0])[0]
    return Number(first) || 0
  } finally {
    release()
  }
}

/**
 * 自检 1：月度库存快照的价格勾稽。
 * 核对恒等式 期初 + 入库 − 出库 = 期末，不平的条数应为 0。
 * @returns {Promise<number>} 不平的快照条数
 */
async function countSnapshotUnbalanced() {
  return countQuery(
    `SELECT COUNT(*) AS bad FROM \`inventory_snapshot\`
     WHERE ABS(begin_qty + in_qty - out_qty - end_qty) > 0.01`
  )
}

/**
 * 自检 2：期末库存不为负。
 * 负库存意味着推演逻辑漏了出库约束，是必须拦住的问题。
 * @returns {Promise<number>} 期末数量为负的快照条数
 */
async function countNegativeEndStock() {
  return countQuery(
    `SELECT COUNT(*) AS bad FROM \`inventory_snapshot\` WHERE end_qty < 0`
  )
}

/**
 * 自检 3：库存金额与「期末数量 × 期末单价」一致。
 * 金额若对不上，说明快照不是从库存金额直接落下来的，后续成本口径会全线失真。
 * @returns {Promise<number>} 金额不平的快照条数
 */
async function countSnapshotAmountMismatch() {
  return countQuery(
    `SELECT COUNT(*) AS bad FROM \`inventory_snapshot\`
     WHERE end_qty > 0 AND ABS(amount - end_qty * unit_price) > 0.02`
  )
}

/**
 * 自检 4：订单合格数量 = 对应入库流水数量。
 * 注意核对的是「合格数量」而不是「到货数量」——不良品不入库，
 * 所以到货量本身大于入库量是正常的，真正应当相等的是合格品的数量。
 * @returns {Promise<number>} 不匹配的订单条数
 */
async function countOrderInboundMismatch() {
  return countQuery(
    `SELECT COUNT(*) AS bad FROM (
       SELECT po.order_no,
              COALESCE(SUM(poi.qualified_qty), 0) AS qualified,
              COALESCE(MAX(f.inflow), 0) AS inflow
       FROM \`purchase_order\` po
       LEFT JOIN \`purchase_order_item\` poi ON poi.order_id = po.id
       LEFT JOIN (
         SELECT ref_no, SUM(qty) AS inflow
         FROM \`inventory_flow\`
         WHERE flow_type = 'in' AND ref_type = 'purchase'
         GROUP BY ref_no
       ) f ON f.ref_no = po.order_no
       GROUP BY po.order_no
     ) t
     WHERE ABS(qualified - inflow) > 0.01`
  )
}

module.exports = {
  countSnapshotUnbalanced,
  countNegativeEndStock,
  countSnapshotAmountMismatch,
  countOrderInboundMismatch
}

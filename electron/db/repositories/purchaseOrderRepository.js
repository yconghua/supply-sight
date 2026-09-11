/**
 * 采购订单仓库（Repository Layer）—— 对应 `purchase_order` 与 `purchase_order_item` 两张表
 *
 * 主从两张表作为一个聚合根放在同一个仓库里：订单明细脱离订单没有独立意义。
 *
 * 批量写入的关键难点：明细需要 order_id，而批量 INSERT 拿不到每行的自增主键。
 * 解决办法是「先插主表 → 按订单号查回 id 映射 → 再带 order_id 插明细」，
 * 由 mapIdsByOrderNo 提供映射查询，调用方（模拟器）据此组装明细行。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')
const { buildWhereClause } = require('./queryHelpers')
const { batchInsert } = require('./batchInserter')

// 订单主表批量写入的列顺序
const ORDER_COLUMNS = [
  'order_no',
  'supplier_id',
  'order_date',
  'promised_date',
  'actual_date',
  'total_amount',
  'status'
]

// 订单明细批量写入的列顺序
const ORDER_ITEM_COLUMNS = [
  'order_id',
  'material_id',
  'qty',
  'unit_price',
  'amount',
  'received_qty',
  'qualified_qty',
  'defect_qty'
]

class PurchaseOrderRepository extends BaseRepository {
  constructor() {
    // 聚合根绑定到订单主表
    super('purchase_order')
  }

  /**
   * 按订单号查询订单主表记录
   * @param {string} orderNo 订单号
   * @returns {Object|null}
   */
  async findByOrderNo(orderNo) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        'SELECT * FROM `purchase_order` WHERE order_no = ?',
        [orderNo]
      )
      return rows[0] || null
    } finally {
      release()
    }
  }

  /**
   * 订单列表，支持按供应商 / 状态 / 下单日期区间过滤
   * @param {{ supplierId?: number, status?: string, dateFrom?: string, dateTo?: string }} filters
   * @returns {Object[]} 按下单日期倒序
   */
  async list(filters = {}) {
    const conditions = []
    if (filters.supplierId) {
      conditions.push({ field: 'supplier_id', op: '=', value: filters.supplierId })
    }
    if (filters.status) {
      conditions.push({ field: 'status', op: '=', value: filters.status })
    }
    if (filters.dateFrom) {
      conditions.push({ field: 'order_date', op: '>=', value: filters.dateFrom })
    }
    if (filters.dateTo) {
      conditions.push({ field: 'order_date', op: '<=', value: filters.dateTo })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`purchase_order\` ${clause} ORDER BY order_date DESC, id DESC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 批量写入订单主表（模拟器调用）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreateOrders(rows, onProgress) {
    return batchInsert('purchase_order', ORDER_COLUMNS, rows, { onProgress })
  }

  /**
   * 查询「订单号 → 主键 id」映射，供组装明细时回填 order_id。
   * 订单号有唯一索引，因此这里逐个精确查询，走索引速度足够。
   * @param {string[]} orderNos 订单号数组
   * @returns {Promise<Map<string, number>>}
   */
  async mapIdsByOrderNo(orderNos) {
    const map = new Map()
    if (!Array.isArray(orderNos) || orderNos.length === 0) return map
    const { conn, release } = await this._acquire()
    try {
      // 分批查询，避免 IN 里的占位符过多
      const step = 500
      for (let start = 0; start < orderNos.length; start += step) {
        const slice = orderNos.slice(start, start + step)
        const placeholders = slice.map(() => '?').join(', ')
        const [rows] = await conn.execute(
          `SELECT id, order_no FROM \`purchase_order\` WHERE order_no IN (${placeholders})`,
          slice
        )
        for (const r of rows) {
          map.set(r.order_no, r.id)
        }
      }
      return map
    } finally {
      release()
    }
  }

  /**
   * 批量写入订单明细（模拟器调用，行数据中的 order_id 需由调用方先回填）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreateItems(rows, onProgress) {
    return batchInsert('purchase_order_item', ORDER_ITEM_COLUMNS, rows, { onProgress })
  }

  /**
   * 查询某张订单的全部明细
   * @param {number} orderId 订单主键
   * @returns {Object[]}
   */
  async listItemsByOrderId(orderId) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        'SELECT * FROM `purchase_order_item` WHERE order_id = ? ORDER BY id ASC',
        [orderId]
      )
      return rows
    } finally {
      release()
    }
  }

  // 统计订单总数（数据总览用）
  async count() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `purchase_order`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  // 统计订单明细总数（数据总览用）
  async countItems() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `purchase_order_item`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new PurchaseOrderRepository()

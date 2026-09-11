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

  /**
   * 按物料汇总采购量与采购金额（采购成本模块的基础数据）。
   * 加权均价 = 采购金额 ÷ 采购数量。
   * 这里刻意不对 unit_price 直接取 AVG：同一物料不同批次的采购量差异很大，
   * 直接平均单价会让「一次小批量试单」把整体均价严重带偏，加权才是成本口径的正解。
   * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月
   * @returns {Promise<Object[]>}
   */
  async getCostSummaryByMaterial(options = {}) {
    const values = []
    let windowClause = ''
    if (options.months > 0) {
      windowClause = 'AND po.order_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)'
      values.push(options.months)
    }
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT poi.material_id,
                COUNT(DISTINCT po.id) AS order_count,
                COALESCE(SUM(poi.qty), 0) AS total_qty,
                COALESCE(SUM(poi.amount), 0) AS total_amount,
                COALESCE(SUM(poi.amount) / NULLIF(SUM(poi.qty), 0), 0) AS avg_price,
                MIN(po.order_date) AS first_order_date,
                MAX(po.order_date) AS last_order_date
         FROM \`purchase_order_item\` poi
         JOIN \`purchase_order\` po ON po.id = poi.order_id
         WHERE 1 = 1 ${windowClause}
         GROUP BY poi.material_id`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 按「物料 × 月份」取加权均价序列——价格趋势图与「连续 N 期上涨」趋势规则的数据源。
   * 只返回有采购发生的月份（没有订单的月份不会凭空造出一个均价）。
   * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月
   * @returns {Promise<Object[]>} 元素含 material_id / period / qty / amount / avg_price
   */
  async getMonthlyPriceSeries(options = {}) {
    const values = []
    let windowClause = ''
    if (options.months > 0) {
      windowClause = 'AND po.order_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)'
      values.push(options.months)
    }
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT poi.material_id,
                DATE_FORMAT(po.order_date, '%Y-%m') AS period,
                COALESCE(SUM(poi.qty), 0) AS qty,
                COALESCE(SUM(poi.amount), 0) AS amount,
                COALESCE(SUM(poi.amount) / NULLIF(SUM(poi.qty), 0), 0) AS avg_price
         FROM \`purchase_order_item\` poi
         JOIN \`purchase_order\` po ON po.id = poi.order_id
         WHERE 1 = 1 ${windowClause}
         GROUP BY poi.material_id, DATE_FORMAT(po.order_date, '%Y-%m')
         ORDER BY poi.material_id ASC, period ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 订单明细联查（「交付与质量明细」页用）：订单 + 供应商 + 物料 三表联查。
   * 一次把页面要展示的字段全部带出来（含承诺期与实收期、合格数与不良数），避免前端多次请求。
   * delay_days = 实收日 − 承诺交期：负数表示提前到货，正数表示延迟，未到货为 NULL。
   * @param {{ supplierId?: number, materialId?: number, status?: string, limit?: number }} filters
   * @returns {Promise<Object[]>}
   */
  async listWithDetail(filters = {}) {
    const conditions = []
    const values = []
    if (filters.supplierId) {
      conditions.push('po.supplier_id = ?')
      values.push(filters.supplierId)
    }
    if (filters.materialId) {
      conditions.push('poi.material_id = ?')
      values.push(filters.materialId)
    }
    if (filters.status) {
      conditions.push('po.status = ?')
      values.push(filters.status)
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    // 明细页一次最多展示 2000 行：数据量再大也应当靠筛选去缩小范围，而不是把整库拉给渲染层
    const rawLimit = Number(filters.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 2000) : 500

    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT po.id, po.order_no, po.order_date, po.promised_date, po.actual_date,
                po.status, po.total_amount,
                s.code AS supplier_code, s.name AS supplier_name,
                m.code AS material_code, m.name AS material_name, m.unit,
                poi.qty, poi.unit_price, poi.received_qty, poi.qualified_qty, poi.defect_qty,
                CASE WHEN po.actual_date IS NOT NULL
                     THEN DATEDIFF(po.actual_date, po.promised_date) END AS delay_days
         FROM \`purchase_order\` po
         JOIN \`supplier\` s ON s.id = po.supplier_id
         JOIN \`purchase_order_item\` poi ON poi.order_id = po.id
         JOIN \`material\` m ON m.id = poi.material_id
         ${where}
         ORDER BY po.order_date DESC, po.id DESC
         LIMIT ${limit}`,
        values
      )
      return rows
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new PurchaseOrderRepository()

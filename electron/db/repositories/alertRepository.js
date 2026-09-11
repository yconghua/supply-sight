/**
 * 预警仓库（Repository Layer）—— 对应 `alert_rule` 与 `alert_record` 两张表
 *
 * 规则与记录同属预警这一聚合根：规则是配置，记录是命中结果。
 *
 * 写入策略（upsert）：预警记录有唯一键 (rule_code, target_type, target_id, period)，
 * 扫描时用 ON DUPLICATE KEY UPDATE 更新实测值与描述而不新增行——
 * 这样反复扫描同一账期不会让预警越堆越多，同时「这条预警是哪期触发的」保持可追溯。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')
const { buildWhereClause } = require('./queryHelpers')
const { batchInsert } = require('./batchInserter')

// 预警记录批量写入的列顺序
const RECORD_COLUMNS = [
  'rule_code',
  'module',
  'target_type',
  'target_id',
  'target_name',
  'period',
  'metric_value',
  'threshold_value',
  'severity',
  'status',
  'message'
]

class AlertRepository extends BaseRepository {
  constructor() {
    // 聚合根绑定到预警记录表
    super('alert_record')
  }

  // ---------- 预警规则 ----------

  /**
   * 规则列表，支持按模块 / 启用状态过滤
   * @param {{ module?: string, enabled?: number }} filters enabled 传 1 只取启用的
   * @returns {Object[]} 按模块、编码排序
   */
  async listRules(filters = {}) {
    const conditions = []
    if (filters.module) {
      conditions.push({ field: 'module', op: '=', value: filters.module })
    }
    if (filters.enabled === 0 || filters.enabled === 1) {
      conditions.push({ field: 'enabled', op: '=', value: filters.enabled })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      // params 是 JSON 列：mysql2 会返回已解析的对象
      const [rows] = await conn.execute(
        `SELECT * FROM \`alert_rule\` ${clause} ORDER BY module ASC, code ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 按规则编码查询单条规则
   * @param {string} code 规则编码
   * @returns {Object|null}
   */
  async findRuleByCode(code) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT * FROM `alert_rule` WHERE code = ?', [code])
      return rows[0] || null
    } finally {
      release()
    }
  }

  // 统计规则总数（数据总览用）
  async countRules() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `alert_rule`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  // ---------- 预警记录 ----------

  /**
   * 批量写入预警记录，命中唯一键时更新实测值 / 描述 / 严重度（不新增行）。
   * 为了让 VALUES() 引用生效，列顺序必须与 RECORD_COLUMNS 一致。
   * @param {Array<Object|Array>} rows 行数据
   * @returns {Promise<number>} 提交行数（含更新）
   */
  async batchUpsertRecords(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0
    const { conn, release } = await this._acquire()
    let affected = 0
    try {
      // 复用批量插入的分片逻辑：这里手动拼 SQL，故按批多次执行同一模板
      const chunkSize = 200
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize)
        const rowPlaceholder = `(${RECORD_COLUMNS.map(() => '?').join(', ')})`
        const placeholders = chunk.map(() => rowPlaceholder).join(', ')
        const values = []
        for (const row of chunk) {
          for (const col of RECORD_COLUMNS) {
            values.push(row[col] === undefined ? null : row[col])
          }
        }
        const [result] = await conn.query(
          `INSERT INTO \`alert_record\` (${RECORD_COLUMNS.map((c) => `\`${c}\``).join(', ')})
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE
             metric_value = VALUES(metric_value),
             threshold_value = VALUES(threshold_value),
             severity = VALUES(severity),
             message = VALUES(message),
             module = VALUES(module),
             target_name = VALUES(target_name)`,
          values
        )
        affected += result.affectedRows || 0
        await new Promise((resolve) => setImmediate(resolve))
      }
      return affected
    } finally {
      release()
    }
  }

  /**
   * 预警记录列表，支持按模块 / 状态 / 严重度 / 对象类型过滤
   * @param {{ module?: string, status?: string, severity?: string, targetType?: string }} filters
   * @returns {Object[]} 按触发时间倒序
   */
  async listRecords(filters = {}) {
    const conditions = []
    if (filters.module) {
      conditions.push({ field: 'module', op: '=', value: filters.module })
    }
    if (filters.status) {
      conditions.push({ field: 'status', op: '=', value: filters.status })
    }
    if (filters.severity) {
      conditions.push({ field: 'severity', op: '=', value: filters.severity })
    }
    if (filters.targetType) {
      conditions.push({ field: 'target_type', op: '=', value: filters.targetType })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`alert_record\` ${clause}
         ORDER BY FIELD(severity, 'high', 'medium', 'low'), triggered_at DESC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 更新预警处理状态（预警中心的「处理 / 忽略」动作）
   * @param {number} id 记录 id
   * @param {{ status: string, remark?: string }} param status：resolved / ignored / open
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatus(id, { status, remark = '' }) {
    const { conn, release } = await this._acquire()
    try {
      // handled_at：已处理 / 已忽略时记时间，重新打开则清空
      const handledAt = status === 'open' ? null : new Date()
      const [result] = await conn.execute(
        'UPDATE `alert_record` SET status = ?, remark = ?, handled_at = ? WHERE id = ?',
        [status, remark, handledAt, id]
      )
      return result.affectedRows
    } finally {
      release()
    }
  }

  // 统计预警记录总数（数据总览用）
  async countRecords() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `alert_record`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  // 按严重度统计未处理预警数量（首页仪表盘用）
  async countOpenBySeverity() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT severity, COUNT(*) AS total FROM \`alert_record\`
         WHERE status = 'open' GROUP BY severity`
      )
      const result = { high: 0, medium: 0, low: 0 }
      for (const r of rows) {
        if (result[r.severity] !== undefined) result[r.severity] = Number(r.total)
      }
      return result
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new AlertRepository()

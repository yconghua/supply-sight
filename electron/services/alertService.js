/**
 * 预警规则引擎（Service Layer）
 *
 * 这是「用 JSON 配置实现预警」的落地：规则全部存在 alert_rule 表里，
 * 引擎只负责把指标取出来、按 type 分派到对应的求值器、命中就落一条预警记录。
 * 因此新增一条规则 = 往表里插一行 JSON，不需要改任何代码。
 *
 * 三类求值器（与 alert_rule.type 一一对应）：
 *   threshold 阈值型：把指标和阈值比大小。
 *   trend     趋势型：判断连续 N 期同向变化，并可选校验累计变化幅度。
 *                     需要时序数据，目前用于采购单价（getCostMetrics 提供月度均价序列）。
 *   composite 组合型：用 and / or 把多个阈值条件组合起来。
 *                     典型用例是呆滞库存——「周转天数 > 180」且「近 60 天无出库」，
 *                     两个条件同时满足才算呆滞，避免把正常慢销品误判成呆滞。
 *
 * 指标缺失（例如供应商还没有到货记录，OTD 算不出来）时求值返回 null，
 * 该条直接跳过——「无法判定」和「判定为不合格」是两回事，不能混为一谈。
 *
 * 分层约定：本层只调 Repository 与 metricService，不写 SQL。
 */
const alertRepository = require('../db/repositories/alertRepository')
const metricService = require('./metricService')

/** 指标的中文名与展示格式，用于生成人能读懂的预警描述 */
const METRIC_META = {
  otd_rate: { label: '准时交付率', format: 'percent' },
  ppm: { label: '来料不良率', format: 'ppm' },
  avg_delay_days: { label: '平均延迟', format: 'days' },
  turnover_days: { label: '周转天数', format: 'days' },
  idle_days: { label: '无出库天数', format: 'days' },
  stock_amount: { label: '库存金额', format: 'money' },
  out_amount: { label: '出库金额', format: 'money' },
  price_index: { label: '价格指数', format: 'ratio' },
  avg_price: { label: '加权均价', format: 'money' },
  unit_price: { label: '采购单价', format: 'money' }
}

/** 比较运算符的中文说法 */
const OP_TEXT = { '<': '低于', '<=': '不高于', '>': '高于', '>=': '不低于' }

/** 安全取数 */
function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 按展示格式把指标值转成可读文本 */
function formatValue(metric, value) {
  const meta = METRIC_META[metric] || { format: 'plain' }
  const v = num(value)
  switch (meta.format) {
    case 'percent':
      return (v * 100).toFixed(1) + '%'
    case 'ppm':
      return Math.round(v) + ' PPM'
    case 'days':
      return v.toFixed(0) + ' 天'
    case 'money':
      return '¥' + v.toFixed(2)
    case 'ratio':
      return v.toFixed(3)
    default:
      return String(v)
  }
}

/** 指标键 → 中文名 */
function metricLabel(metric) {
  const meta = METRIC_META[metric]
  return meta ? meta.label : metric
}

/** 通用比较 */
function compare(value, op, threshold) {
  switch (op) {
    case '<':
      return value < threshold
    case '<=':
      return value <= threshold
    case '>':
      return value > threshold
    case '>=':
      return value >= threshold
    case '==':
      return value === threshold
    case '!=':
      return value !== threshold
    default:
      return false
  }
}

/**
 * 阈值型求值。
 * @param {Object} cond 形如 { metric, op, value }
 * @param {Object} metricValues 该对象的指标字典
 * @returns {Object|null} { matched, value, threshold, metric }；指标缺失时返回 null
 */
function evalThreshold(cond, metricValues) {
  const raw = metricValues[cond.metric]
  if (raw === null || raw === undefined) return null
  const value = num(raw)
  const threshold = num(cond.value)
  return {
    matched: compare(value, cond.op, threshold),
    value,
    threshold,
    metric: cond.metric
  }
}

/**
 * 趋势型求值：判断序列末尾是否连续同向变化。
 * @param {Object} params 形如 { metric, direction, periods, min_change_pct }
 * @param {Array<{period: string, value: number}>} series 时序序列（按时间升序）
 * @returns {Object|null}
 */
function evalTrend(params, series) {
  const periods = Math.max(1, Math.round(num(params.periods, 3)))
  const list = Array.isArray(series) ? series.filter((p) => p && p.value !== null) : []
  // 至少要 periods + 1 个点才能判断出 periods 次变化
  if (list.length < periods + 1) return null

  const points = list.slice(-(periods + 1))
  const direction = params.direction === 'down' ? 'down' : 'up'

  // 逐段校验是否严格同向
  for (let i = 1; i < points.length; i++) {
    const prev = num(points[i - 1].value)
    const cur = num(points[i].value)
    const ok = direction === 'up' ? cur > prev : cur < prev
    if (!ok) {
      return {
        matched: false,
        value: num(points[points.length - 1].value),
        threshold: num(points[0].value),
        metric: params.metric,
        periods,
        change: 0
      }
    }
  }

  const first = num(points[0].value)
  const last = num(points[points.length - 1].value)
  const change = first > 0 ? (last - first) / first : 0
  const minChange = num(params.min_change_pct, 0)
  // 未配置最小涨幅时，只要连续同向就算命中
  const matched = minChange > 0 ? Math.abs(change) >= minChange : true

  return {
    matched,
    value: last,
    threshold: first,
    metric: params.metric,
    periods,
    change
  }
}

/**
 * 组合型求值：用 and / or 组合多个阈值条件。
 * 任一子条件的指标缺失，整体就返回 null（无法判定），不做「缺失即不满足」的默认处理。
 * @param {Object} params 形如 { logic, conditions: [{ metric, op, value }] }
 * @param {Object} metricValues
 * @returns {Object|null}
 */
function evalComposite(params, metricValues) {
  const conditions = Array.isArray(params.conditions) ? params.conditions : []
  if (!conditions.length) return null

  const results = conditions.map((c) => evalThreshold(c, metricValues))
  if (results.some((r) => r === null)) return null

  const logic = params.logic === 'or' ? 'or' : 'and'
  const matched = logic === 'or'
    ? results.some((r) => r.matched)
    : results.every((r) => r.matched)

  // 展示用的「主条件」：and 取第一个，or 取第一个命中的（都没命中就取第一个）
  const pivot = logic === 'and'
    ? results[0]
    : (results.find((r) => r.matched) || results[0])

  return {
    matched,
    value: pivot.value,
    threshold: pivot.threshold,
    metric: pivot.metric,
    parts: results,
    logic
  }
}

/** 根据模块从对象里抽出指标字典（规则里写的 metric 键必须在这里有对应） */
function buildMetricValues(moduleName, row) {
  if (moduleName === 'supplier') {
    return {
      otd_rate: row.otdRate,
      ppm: row.ppm,
      avg_delay_days: row.avgDelayDays,
      purchase_amount: row.totalAmount
    }
  }
  if (moduleName === 'inventory') {
    return {
      turnover_days: row.turnoverDays,
      idle_days: row.idleDays,
      stock_amount: row.amount,
      out_amount: row.outAmount
    }
  }
  if (moduleName === 'cost') {
    return {
      price_index: row.priceIndex,
      avg_price: row.avgPrice,
      unit_price: row.currentPrice,
      purchase_amount: row.totalAmount
    }
  }
  return {}
}

/** 把对象的指标转成时序序列（目前只有成本模块的月度均价有时序） */
function buildSeries(moduleName, row) {
  if (moduleName === 'cost' && Array.isArray(row.series)) {
    return row.series.map((p) => ({ period: p.period, value: p.avgPrice }))
  }
  return []
}

/**
 * 对单个对象求值一条规则。
 * @returns {Object|null} { matched, value, threshold, metric, change }；无法判定返回 null
 */
function evaluateRule(rule, params, metricValues, series) {
  if (rule.type === 'trend') {
    return evalTrend(params, series)
  }
  if (rule.type === 'composite') {
    return evalComposite(params, metricValues)
  }
  // 默认按阈值型处理
  return evalThreshold(params, metricValues)
}

/** 生成人能读懂的预警描述 */
function buildMessage(rule, params, result) {
  const label = metricLabel(result.metric)
  if (rule.type === 'trend') {
    const dirText = params.direction === 'down' ? '下降' : '上涨'
    const pct = result.change ? Math.abs(result.change * 100).toFixed(1) : '0.0'
    return `采购单价连续 ${result.periods} 个月${dirText}，累计变动 ${pct}%`
  }
  if (rule.type === 'composite') {
    const parts = (result.parts || [])
      .map((p) => `${metricLabel(p.metric)} ${formatValue(p.metric, p.value)}`)
      .join(result.logic === 'or' ? '，或 ' : '，且 ')
    return `${parts}（${rule.name}）`
  }
  const opText = OP_TEXT[params.op] || params.op
  return `${label} ${formatValue(result.metric, result.value)}，${opText}阈值 ${formatValue(result.metric, result.threshold)}`
}

/** 当前账期（YYYY-MM），用于预警记录归期 */
function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 全量扫描：执行所有启用的规则，把命中结果写入预警记录。
 * @returns {Promise<{ success: boolean, ruleCount?: number, scanned?: number, matched?: number, message?: string }>}
 */
async function scanAll() {
  try {
    const rules = await alertRepository.listRules({ enabled: 1 })
    if (!rules.length) {
      return { success: true, ruleCount: 0, scanned: 0, matched: 0 }
    }

    // 指标按「模块 + 窗口」缓存：同一窗口的多条规则只查一次库
    const cache = new Map()
    const loadMetrics = async (moduleName, months) => {
      const key = `${moduleName}:${months || 'all'}`
      if (cache.has(key)) return cache.get(key)
      const options = months > 0 ? { months } : {}
      let data
      if (moduleName === 'supplier') {
        data = await metricService.getSupplierMetrics(options)
      } else if (moduleName === 'inventory') {
        data = (await metricService.getInventoryMetrics(options)).items
      } else if (moduleName === 'cost') {
        data = (await metricService.getCostMetrics(options)).items
      } else {
        data = []
      }
      cache.set(key, data)
      return data
    }

    const records = []
    let scanned = 0
    const fallbackPeriod = currentPeriod()

    for (const rule of rules) {
      // params 是 JSON 列，mysql2 已解析成对象；兼容极端情况下返回字符串
      let params = rule.params
      if (typeof params === 'string') {
        try {
          params = JSON.parse(params)
        } catch (e) {
          params = {}
        }
      }
      if (!params || typeof params !== 'object') params = {}

      const months = num(params.window_months, 0)
      const rows = await loadMetrics(rule.module, months)
      const targetType = rule.module === 'supplier' ? 'supplier' : 'material'

      for (const row of rows) {
        scanned += 1
        const metricValues = buildMetricValues(rule.module, row)
        const series = buildSeries(rule.module, row)
        const result = evaluateRule(rule, params, metricValues, series)
        // 无法判定（指标缺失）或未命中：跳过
        if (!result || !result.matched) continue

        const targetId = rule.module === 'supplier' ? row.id : row.materialId
        const targetName = row.name || ''
        // 账期：库存模块用快照账期，其余用当前月
        const period = rule.module === 'inventory' && row.period ? row.period : fallbackPeriod

        records.push({
          rule_code: rule.code,
          module: rule.module,
          target_type: targetType,
          target_id: targetId,
          target_name: targetName,
          period,
          metric_value: num(result.value),
          threshold_value: num(result.threshold),
          severity: rule.severity || 'medium',
          status: 'open',
          message: buildMessage(rule, params, result)
        })
      }
    }

    const affected = await alertRepository.batchUpsertRecords(records)
    return {
      success: true,
      ruleCount: rules.length,
      scanned,
      matched: records.length,
      affected
    }
  } catch (err) {
    console.error('[alertService.scanAll] 数据库异常:', err)
    return {
      success: false,
      message: err && err.message ? err.message : '预警扫描失败'
    }
  }
}

/**
 * 预警记录列表。
 * @param {{ module?: string, status?: string, severity?: string }} filters
 */
async function listRecords(filters = {}) {
  try {
    const records = await alertRepository.listRecords(filters)
    const summary = await alertRepository.countOpenBySeverity()
    return { success: true, records, summary }
  } catch (err) {
    console.error('[alertService.listRecords] 数据库异常:', err)
    return { success: false, message: err && err.message ? err.message : '读取预警记录失败' }
  }
}

/**
 * 更新预警处理状态（处理 / 忽略 / 重新打开）。
 * @param {{ id: number, status: string, remark?: string }} payload
 */
async function updateRecordStatus({ id, status, remark = '' }) {
  if (!id) return { success: false, message: '缺少预警记录标识' }
  if (!['open', 'resolved', 'ignored'].includes(status)) {
    return { success: false, message: '处理状态不合法' }
  }
  try {
    const affected = await alertRepository.updateStatus(id, { status, remark })
    return { success: affected > 0, message: affected > 0 ? '已更新' : '记录不存在' }
  } catch (err) {
    console.error('[alertService.updateRecordStatus] 数据库异常:', err)
    return { success: false, message: err && err.message ? err.message : '更新失败' }
  }
}

/**
 * 规则清单（只读展示；规则的增删改直接改 JSON / 数据库，不在界面上做编辑器）。
 * @param {{ module?: string, enabled?: number }} filters
 */
async function listRules(filters = {}) {
  try {
    const rules = await alertRepository.listRules(filters)
    return { success: true, rules }
  } catch (err) {
    console.error('[alertService.listRules] 数据库异常:', err)
    return { success: false, message: err && err.message ? err.message : '读取规则失败' }
  }
}

module.exports = {
  scanAll,
  listRecords,
  updateRecordStatus,
  listRules
}

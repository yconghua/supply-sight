<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">预警规则</h2>
        <p class="mod-desc">
          规则以 JSON 存在数据库里，引擎按 type 分派求值器。因此<strong>新增一条规则只需要加一行配置，不用改代码</strong>——
          本页只做只读展示。
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !rules.length && !error" class="empty">暂无规则。初始化数据库时应已内置 6 条默认规则。</p>

    <template v-if="rules.length">
      <section class="stat-row">
        <div class="stat"><b>{{ rules.length }}</b><span>规则总数</span></div>
        <div class="stat"><b>{{ countBy('threshold') }}</b><span>阈值型</span></div>
        <div class="stat"><b>{{ countBy('trend') }}</b><span>趋势型</span></div>
        <div class="stat"><b>{{ countBy('composite') }}</b><span>组合型</span></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3 class="card-title">规则清单</h3>
          <span class="card-sub">共 {{ rules.length }} 条，启用 {{ enabledCount }} 条</span>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>规则</th>
              <th>模块</th>
              <th>类型</th>
              <th>严重度</th>
              <th>状态</th>
              <th>参数</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rules" :key="r.code">
              <td>
                <div class="cell-name">{{ r.name }}</div>
                <div class="cell-sub">{{ r.code }}</div>
              </td>
              <td>{{ moduleText(r.module) }}</td>
              <td><span class="type-tag" :class="r.type">{{ typeText(r.type) }}</span></td>
              <td><span class="sev" :class="r.severity">{{ sevText(r.severity) }}</span></td>
              <td>
                <span class="switch" :class="{ on: Number(r.enabled) === 1 }">
                  {{ Number(r.enabled) === 1 ? '已启用' : '已停用' }}
                </span>
              </td>
              <td class="params"><code>{{ formatParams(r.params, r.type) }}</code></td>
              <td class="desc">{{ r.description }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <div class="card-head">
          <h3 class="card-title">三类规则的求值方式</h3>
        </div>
        <ul class="explain">
          <li>
            <b>阈值型</b>：把指标和阈值比大小。例如「准时交付率 &lt; 90%」。
            参数形如 <code>{'{"metric":"otd_rate","op":"<","value":0.9,"window_months":3}'}</code>。
          </li>
          <li>
            <b>趋势型</b>：判断连续 N 期是否同向变化，并可要求累计变化超过一定幅度。
            例如「采购单价连续 3 个月上涨且累计涨幅 &gt; 5%」。需要时序数据，目前用于成本模块。
          </li>
          <li>
            <b>组合型</b>：用 and / or 组合多个阈值条件。典型用例是呆滞库存——
            「周转天数 &gt; 180」<b>且</b>「近 60 天无出库」同时成立才算呆滞，避免误杀正常慢销品。
          </li>
        </ul>
        <p class="footnote">
          <code>window_months</code> 控制统计窗口（只统计最近 N 个月）；不传则按全部历史数据计算。
          指标缺失时该条规则会被跳过——「无法判定」和「判定为不合格」是两回事。
        </p>
      </section>
    </template>
  </div>
</template>

<script setup>
// 预警规则（只读）：展示库里的规则配置与求值方式说明。
// 规则的增删改直接改数据库 / schemas 种子文件，不在界面上做编辑器。
import { ref, computed, onMounted } from 'vue'
import { getAlertRules } from '../../api'

const rules = ref([])
const loading = ref(false)
const error = ref('')

const enabledCount = computed(() => rules.value.filter((r) => Number(r.enabled) === 1).length)

function countBy(type) {
  return rules.value.filter((r) => r.type === type).length
}
function moduleText(m) {
  return m === 'supplier' ? '供应商' : m === 'inventory' ? '库存' : m === 'cost' ? '成本' : m
}
function typeText(t) {
  return t === 'threshold' ? '阈值型' : t === 'trend' ? '趋势型' : t === 'composite' ? '组合型' : t
}
function sevText(s) {
  return s === 'high' ? '高' : s === 'medium' ? '中' : s === 'low' ? '低' : s
}

// 参数格式化：JSON 列 mysql2 已解析成对象；兼容返回字符串的情况
function formatParams(params, type) {
  if (!params) return '—'
  let obj = params
  if (typeof params === 'string') {
    try {
      obj = JSON.parse(params)
    } catch (e) {
      return params
    }
  }
  if (type === 'composite') {
    const logic = obj.logic === 'or' ? ' 或 ' : ' 且 '
    const parts = (obj.conditions || []).map((c) => `${c.metric} ${c.op} ${c.value}`)
    return '[' + parts.join(logic) + ']'
  }
  if (type === 'trend') {
    const dir = obj.direction === 'down' ? '连续下降' : '连续上涨'
    const pct = obj.min_change_pct ? `，累计 > ${(obj.min_change_pct * 100).toFixed(1)}%` : ''
    return `${obj.metric} ${dir} ${obj.periods} 期${pct}`
  }
  const win = obj.window_months ? `（近 ${obj.window_months} 个月）` : ''
  return `${obj.metric} ${obj.op} ${obj.value}${win}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getAlertRules({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取规则失败'
      rules.value = []
      return
    }
    rules.value = res.rules || []
  } catch (e) {
    error.value = e && e.message ? e.message : '读取规则失败'
    rules.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.mod {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mod-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.mod-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1d2129;
}
.mod-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8a9099;
  line-height: 1.7;
  max-width: 800px;
}
.mod-desc strong {
  color: #0d47a1;
}
.btn-ghost {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  color: #0d47a1;
  background: #fff;
  border: 1px solid #cfe0f5;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-ghost:hover:not(:disabled) {
  background: #f0f7ff;
}
.btn-ghost:disabled {
  color: #a8b0b8;
  border-color: #e4e7ec;
  cursor: not-allowed;
}
.err {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #c62828;
  background: #fdecea;
  border-radius: 10px;
}
.empty {
  margin: 0;
  padding: 40px;
  text-align: center;
  font-size: 14px;
  color: #8a9099;
  background: #fff;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.stat {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.stat b {
  display: block;
  font-size: 20px;
  color: #0d47a1;
}
.stat span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.card {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
}
.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1d2129;
}
.card-sub {
  font-size: 12px;
  color: #a8b0b8;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  text-align: left;
  padding: 9px 10px;
  font-weight: 500;
  color: #8a9099;
  border-bottom: 1px solid #f0f2f5;
  white-space: nowrap;
}
.tbl td {
  padding: 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
  vertical-align: top;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.cell-name {
  color: #1d2129;
  font-weight: 500;
}
.cell-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #a8b0b8;
  font-family: Consolas, Monaco, monospace;
}
.type-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: #eef2f7;
  color: #4a5158;
}
.type-tag.threshold {
  background: #e3f2fd;
  color: #0d47a1;
}
.type-tag.trend {
  background: #fff4e5;
  color: #b26a00;
}
.type-tag.composite {
  background: #f3e5f5;
  color: #7b1fa2;
}
.sev {
  display: inline-block;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 5px;
  font-size: 11px;
  color: #fff;
}
.sev.high {
  background: #e53935;
}
.sev.medium {
  background: #fb8c00;
}
.sev.low {
  background: #90a4ae;
}
.switch {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: #f2f4f7;
  color: #78909c;
}
.switch.on {
  background: #e8f5e9;
  color: #2e7d32;
}
.params code {
  display: inline-block;
  padding: 3px 8px;
  background: #f7f9fc;
  border-radius: 6px;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  color: #0d47a1;
  max-width: 300px;
  white-space: normal;
  line-height: 1.6;
}
.desc {
  max-width: 320px;
  font-size: 12px;
  color: #5f6a75;
  line-height: 1.7;
}
.explain {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #4a5158;
  line-height: 1.9;
}
.explain li {
  margin-bottom: 8px;
}
.explain b {
  color: #1d2129;
}
.explain code {
  padding: 1px 6px;
  background: #f7f9fc;
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  color: #0d47a1;
}
.footnote {
  margin: 12px 0 0;
  font-size: 12px;
  color: #a8b0b8;
  line-height: 1.8;
}
.footnote code {
  padding: 1px 6px;
  background: #f7f9fc;
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
}
</style>

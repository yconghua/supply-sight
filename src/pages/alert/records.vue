<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">预警列表</h2>
        <p class="mod-desc">
          规则引擎扫出来的异常都收口在这里。同一规则对同一对象的同一账期只保留一条记录，
          反复扫描只会更新实测值，不会越堆越多。
        </p>
      </div>
      <button class="btn-primary" :disabled="scanning" @click="handleScan">
        {{ scanning ? '扫描中…' : '立即扫描' }}
      </button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="scanTip" class="tip">{{ scanTip }}</p>

    <section class="stat-row">
      <div class="stat high"><b>{{ summary.high }}</b><span>高严重度未处理</span></div>
      <div class="stat medium"><b>{{ summary.medium }}</b><span>中严重度未处理</span></div>
      <div class="stat low"><b>{{ summary.low }}</b><span>低严重度未处理</span></div>
      <div class="stat"><b>{{ records.length }}</b><span>当前筛选结果</span></div>
    </section>

    <section class="filters">
      <label class="fl">模块
        <select v-model="filterModule">
          <option value="">全部</option>
          <option value="supplier">供应商</option>
          <option value="inventory">库存</option>
          <option value="cost">成本</option>
        </select>
      </label>
      <label class="fl">状态
        <select v-model="filterStatus">
          <option value="">全部</option>
          <option value="open">未处理</option>
          <option value="resolved">已处理</option>
          <option value="ignored">已忽略</option>
        </select>
      </label>
      <label class="fl">严重度
        <select v-model="filterSeverity">
          <option value="">全部</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
      </label>
      <button class="btn-ghost" @click="load">查询</button>
    </section>

    <section class="card">
      <p v-if="!records.length" class="none">
        没有符合条件的预警。如果还没有扫描过，点右上角「立即扫描」按当前规则跑一次。
      </p>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>严重度</th>
            <th>模块</th>
            <th>对象</th>
            <th>账期</th>
            <th>实测值</th>
            <th>阈值</th>
            <th>说明</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id" :class="'row-' + r.severity">
            <td><span class="sev" :class="r.severity">{{ sevText(r.severity) }}</span></td>
            <td>{{ moduleText(r.module) }}</td>
            <td>
              <div class="cell-name">{{ r.target_name || '—' }}</div>
              <div class="cell-sub">{{ r.rule_code }}</div>
            </td>
            <td class="mono">{{ r.period }}</td>
            <td>{{ fmtNum(r.metric_value) }}</td>
            <td>{{ fmtNum(r.threshold_value) }}</td>
            <td class="msg">{{ r.message }}</td>
            <td><span class="st" :class="r.status">{{ statusText(r.status) }}</span></td>
            <td class="ops">
              <button v-if="r.status !== 'resolved'" class="op ok" @click="handleUpdate(r, 'resolved')">处理</button>
              <button v-if="r.status !== 'ignored'" class="op" @click="handleUpdate(r, 'ignored')">忽略</button>
              <button v-if="r.status !== 'open'" class="op" @click="handleUpdate(r, 'open')">重开</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
// 预警列表：一键扫描 + 记录筛选 + 处理（处理 / 忽略 / 重开）。
// 扫描在主进程执行规则引擎，命中结果 upsert 进 alert_record，本页只负责发起与展示。
import { ref, onMounted } from 'vue'
import { scanAlerts, getAlertRecords, updateAlertStatus } from '../../api'

const records = ref([])
const summary = ref({ high: 0, medium: 0, low: 0 })
const loading = ref(false)
const scanning = ref(false)
const error = ref('')
const scanTip = ref('')

const filterModule = ref('')
const filterStatus = ref('')
const filterSeverity = ref('')

function sevText(s) {
  return s === 'high' ? '高' : s === 'medium' ? '中' : s === 'low' ? '低' : s
}
function moduleText(m) {
  return m === 'supplier' ? '供应商' : m === 'inventory' ? '库存' : m === 'cost' ? '成本' : m
}
function statusText(s) {
  return s === 'open' ? '未处理' : s === 'resolved' ? '已处理' : s === 'ignored' ? '已忽略' : s
}
function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2)
}

// 拉取记录（带筛选）
async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getAlertRecords({
      module: filterModule.value || undefined,
      status: filterStatus.value || undefined,
      severity: filterSeverity.value || undefined
    })
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取预警记录失败'
      records.value = []
      return
    }
    records.value = res.records || []
    summary.value = res.summary || { high: 0, medium: 0, low: 0 }
  } catch (e) {
    error.value = e && e.message ? e.message : '读取预警记录失败'
    records.value = []
  } finally {
    loading.value = false
  }
}

// 触发一次全量扫描
async function handleScan() {
  scanning.value = true
  error.value = ''
  scanTip.value = ''
  try {
    const res = await scanAlerts()
    if (!res || !res.success) {
      error.value = (res && res.message) || '扫描失败'
      return
    }
    scanTip.value =
      '扫描完成：执行 ' + res.ruleCount + ' 条规则，检查 ' + res.scanned +
      ' 个对象，命中 ' + res.matched + ' 条预警。'
    await load()
  } catch (e) {
    error.value = e && e.message ? e.message : '扫描失败'
  } finally {
    scanning.value = false
  }
}

// 更新处理状态
async function handleUpdate(record, status) {
  try {
    const res = await updateAlertStatus({ id: record.id, status })
    if (!res || !res.success) {
      error.value = (res && res.message) || '更新失败'
      return
    }
    await load()
  } catch (e) {
    error.value = e && e.message ? e.message : '更新失败'
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
  max-width: 780px;
}
.btn-primary {
  height: 34px;
  padding: 0 22px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: #0d47a1;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-primary:hover:not(:disabled) {
  background: #1565c0;
}
.btn-primary:disabled {
  background: #a8b0b8;
  cursor: not-allowed;
}
.btn-ghost {
  height: 30px;
  padding: 0 16px;
  font-size: 13px;
  color: #0d47a1;
  background: #fff;
  border: 1px solid #cfe0f5;
  border-radius: 6px;
  cursor: pointer;
}
.btn-ghost:hover {
  background: #f0f7ff;
}
.err {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #c62828;
  background: #fdecea;
  border-radius: 10px;
}
.tip {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #0d47a1;
  background: #f0f7ff;
  border-radius: 10px;
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
  font-size: 22px;
  color: #0d47a1;
}
.stat span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.stat.high b {
  color: #c62828;
}
.stat.medium b {
  color: #ef6c00;
}
.stat.low b {
  color: #607d8b;
}
.filters {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
}
.fl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4a5158;
}
.fl select {
  height: 30px;
  padding: 0 8px;
  font-size: 13px;
  color: #1d2129;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
}
.card {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  overflow-x: auto;
}
.none {
  margin: 0;
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  color: #8a9099;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
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
  vertical-align: middle;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.row-high {
  background: #fffafa;
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
.mono {
  font-family: Consolas, Monaco, monospace;
}
.msg {
  max-width: 300px;
  white-space: normal;
  line-height: 1.6;
  color: #5f6a75;
}
.st {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.st.open {
  background: #fdecea;
  color: #c62828;
}
.st.resolved {
  background: #e8f5e9;
  color: #2e7d32;
}
.st.ignored {
  background: #f2f4f7;
  color: #78909c;
}
.ops {
  white-space: nowrap;
}
.op {
  height: 24px;
  padding: 0 10px;
  margin-right: 4px;
  font-size: 12px;
  color: #4a5158;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 5px;
  cursor: pointer;
}
.op:hover {
  border-color: #0d47a1;
  color: #0d47a1;
}
.op.ok:hover {
  border-color: #2e7d32;
  color: #2e7d32;
}
</style>

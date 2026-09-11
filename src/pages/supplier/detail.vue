<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">交付与质量明细</h2>
        <p class="mod-desc">逐单核对承诺交期与实际到货日，以及每批来料的合格数与不良数——OTD 与 PPM 就是从这里汇总出来的。</p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <section class="filters">
      <label class="fl">供应商
        <select v-model="filterSupplier">
          <option value="">全部</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label class="fl">状态
        <select v-model="filterStatus">
          <option value="">全部</option>
          <option value="received">已到货</option>
          <option value="pending">在途</option>
        </select>
      </label>
      <label class="chk"><input v-model="onlyLate" type="checkbox" />只看延迟到货</label>
      <span class="count">共 {{ filtered.length }} 条<span v-if="truncated">（仅显示最近 {{ limit }} 条）</span></span>
    </section>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !rows.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <section v-if="rows.length" class="card">
      <table class="tbl">
        <thead>
          <tr>
            <th>订单号</th>
            <th>供应商</th>
            <th>物料</th>
            <th>下单日</th>
            <th>承诺交期</th>
            <th>实际到货</th>
            <th>交付偏差</th>
            <th>到货数量</th>
            <th>合格 / 不良</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id + '-' + r.order_no" :class="{ late: r.delayDays > 0 }">
            <td class="mono">{{ r.order_no }}</td>
            <td>{{ r.supplier_name }}</td>
            <td>
              <div class="cell-name">{{ r.material_name }}</div>
              <div class="cell-sub">{{ r.material_code }}</div>
            </td>
            <td class="mono">{{ r.order_date }}</td>
            <td class="mono">{{ r.promised_date }}</td>
            <td class="mono">{{ r.actual_date || '—' }}</td>
            <td :class="delayClass(r.delayDays)">{{ fmtDelay(r.delayDays) }}</td>
            <td>{{ fmtNum(r.received_qty) }} {{ r.unit }}</td>
            <td>
              <span class="ok">{{ fmtNum(r.qualified_qty) }}</span> /
              <span :class="{ bad: Number(r.defect_qty) > 0 }">{{ fmtNum(r.defect_qty) }}</span>
            </td>
            <td>¥{{ fmtNum(r.total_amount) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
// 交付与质量明细：订单级联查列表 + 供应商 / 状态 / 延迟筛选。
// 数据来自主进程的 supplyService.getOrderDetails（订单 + 供应商 + 物料 三表联查）。
import { ref, computed, onMounted } from 'vue'
import { getOrderList } from '../../api'

const rows = ref([])
const loading = ref(false)
const error = ref('')
const limit = 500

const filterSupplier = ref('')
const filterStatus = ref('')
const onlyLate = ref(false)

// 供应商下拉选项：直接从订单数据里去重提取，省掉一次额外请求
const suppliers = computed(() => {
  const map = new Map()
  for (const r of rows.value) {
    if (!map.has(r.supplier_code)) map.set(r.supplier_code, { id: r.supplier_code, name: r.supplier_name })
  }
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
})

// 是否发生了截断（后端有 2000 行上限，这里按 500 请求）
const truncated = computed(() => rows.value.length >= limit)

const filtered = computed(() => {
  return rows.value.filter((r) => {
    if (filterSupplier.value && r.supplier_code !== filterSupplier.value) return false
    if (filterStatus.value && r.status !== filterStatus.value) return false
    if (onlyLate.value && !(r.delayDays > 0)) return false
    return true
  })
})

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtDelay(v) {
  if (v === null || v === undefined) return '在途'
  const n = Number(v)
  if (n > 0) return '延迟 ' + n + ' 天'
  if (n < 0) return '提前 ' + Math.abs(n) + ' 天'
  return '准时'
}
function delayClass(v) {
  if (v === null || v === undefined) return ''
  return Number(v) > 0 ? 'bad' : 'ok'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getOrderList({ limit })
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取订单明细失败'
      rows.value = []
      return
    }
    // 把后端的下划线字段转成页面用的驼峰，避免模板里满是下划线
    rows.value = (res.orders || []).map((r) => ({
      ...r,
      delayDays: r.delay_days === null || r.delay_days === undefined ? null : Number(r.delay_days)
    }))
  } catch (e) {
    error.value = e && e.message ? e.message : '读取订单明细失败'
    rows.value = []
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

.filters {
  display: flex;
  align-items: center;
  gap: 18px;
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
  max-width: 190px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4a5158;
  cursor: pointer;
}
.count {
  margin-left: auto;
  font-size: 12px;
  color: #a8b0b8;
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

.card {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tbl th {
  text-align: left;
  padding: 8px 10px;
  font-weight: 500;
  color: #8a9099;
  border-bottom: 1px solid #f0f2f5;
  white-space: nowrap;
}
.tbl td {
  padding: 9px 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
  white-space: nowrap;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.tbl tr.late {
  background: #fffafa;
}
.mono {
  font-family: Consolas, Monaco, monospace;
}
.cell-name {
  color: #1d2129;
}
.cell-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #a8b0b8;
}
.ok {
  color: #2e7d32;
}
.bad {
  color: #c62828;
  font-weight: 500;
}
</style>

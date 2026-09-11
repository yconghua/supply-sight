<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">呆滞与周转</h2>
        <p class="mod-desc">
          呆滞判定用<strong>组合条件</strong>：周转天数 &gt; {{ turnoverLimit }} 天 <strong>且</strong>
          连续 {{ idleLimit }} 天没有出库——两个条件同时满足才算呆滞，避免把正常慢销品误杀。
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <template v-if="items.length">
      <section class="stat-row">
        <div class="stat warn"><b>{{ deadItems.length }}</b><span>呆滞物料数</span></div>
        <div class="stat warn"><b>¥{{ fmtMoney(deadAmount) }}</b><span>呆滞占用金额</span></div>
        <div class="stat"><b>{{ fmtRatio(deadRatio) }}</b><span>占库存总额</span></div>
        <div class="stat"><b>{{ fmtDays(avgTurnover) }}</b><span>全部物料平均周转</span></div>
      </section>

      <!-- 呆滞清单 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">呆滞物料清单</h3>
          <span class="card-sub">共 {{ deadItems.length }} 项，合计 ¥{{ fmtNum(deadAmount) }}</span>
        </div>
        <p v-if="!deadItems.length" class="none">当前没有命中呆滞条件的物料。</p>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>物料</th>
              <th>ABC</th>
              <th>期末数量</th>
              <th>库存金额</th>
              <th>周转天数</th>
              <th>无出库天数</th>
              <th>最后出库</th>
              <th>起订量 MOQ</th>
              <th>建议</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in deadItems" :key="it.materialId">
              <td>
                <div class="cell-name">{{ it.name }}</div>
                <div class="cell-sub">{{ it.code }} · {{ it.category }}</div>
              </td>
              <td><span class="abc-tag small" :class="'abc-' + it.abcClass">{{ it.abcClass }}</span></td>
              <td>{{ fmtNum(it.endQty) }} {{ it.unit }}</td>
              <td>¥{{ fmtNum(it.amount) }}</td>
              <td class="bad">{{ fmtDays(it.turnoverDays) }}</td>
              <td class="bad">{{ fmtDays(it.idleDays) }}</td>
              <td class="mono">{{ it.lastOutDate || '—' }}</td>
              <td>{{ fmtNum(it.moq) }}</td>
              <td class="advice">{{ advice(it) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 周转排行 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">周转天数排行（前 20，最慢的排最前）</h3>
          <span class="card-sub">周转天数 = 统计期天数 ÷（出库金额 ÷ 平均库存金额）</span>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>物料</th>
              <th>期末金额</th>
              <th class="th-wide">周转天数</th>
              <th>近 12 个月出库金额</th>
              <th>平均库存金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in slowest" :key="it.materialId">
              <td>
                <div class="cell-name">{{ it.name }}</div>
                <div class="cell-sub">{{ it.code }}</div>
              </td>
              <td>¥{{ fmtNum(it.amount) }}</td>
              <td>
                <div class="bar-wrap">
                  <div class="bar" :style="{ width: turnoverBar(it.turnoverDays) }"></div>
                </div>
                <span class="bar-text">{{ fmtDays(it.turnoverDays) }}</span>
              </td>
              <td>¥{{ fmtNum(it.outAmount) }}</td>
              <td>¥{{ fmtNum(it.avgAmount) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup>
// 呆滞与周转：把「周转慢 + 长期无出库」的物料挑出来，并给出可执行的处置建议。
// 判定阈值与库里的 INV_DEAD_STOCK 规则保持一致：周转 > 180 天 且 无出库 > 60 天。
import { ref, computed, onMounted } from 'vue'
import { getInventoryMetrics } from '../../api'

const items = ref([])
const summary = ref({})
const loading = ref(false)
const error = ref('')

const turnoverLimit = 180
const idleLimit = 60

const deadItems = computed(() => items.value.filter((it) => it.isDead))
const deadAmount = computed(() => deadItems.value.reduce((a, it) => a + it.amount, 0))
const deadRatio = computed(() => {
  const total = summary.value.totalAmount || 0
  return total > 0 ? deadAmount.value / total : 0
})
const avgTurnover = computed(() => summary.value.avgTurnoverDays ?? null)

// 周转最慢的前 20 项（没有任何出库的排最前）
const slowest = computed(() => {
  return [...items.value]
    .sort((a, b) => {
      const av = a.turnoverDays === null ? Number.MAX_SAFE_INTEGER : a.turnoverDays
      const bv = b.turnoverDays === null ? Number.MAX_SAFE_INTEGER : b.turnoverDays
      return bv - av
    })
    .slice(0, 20)
})
const maxTurnover = computed(() => {
  const list = items.value.map((it) => it.turnoverDays).filter((v) => v !== null)
  return Math.max(1, ...list)
})

// 处置建议：结合是否有库存与起订量，给一句可执行的话，而不是只报一个数字
function advice(it) {
  if (it.endQty <= 0) return '已无库存，无需处理'
  if (it.moq > it.endQty) return '起订量高于剩余用量，建议与供应商协商拆分采购'
  if (it.idleDays > 365) return '停用超一年，建议评估报废或折价转让'
  return '暂停补货，优先消耗现有库存'
}

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtMoney(v) {
  const n = Number(v) || 0
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万'
  return n.toFixed(0)
}
function fmtDays(v) {
  return v === null || v === undefined ? '—' : Math.round(v) + ' 天'
}
function fmtRatio(v) {
  return v === null || v === undefined ? '—' : (v * 100).toFixed(2) + '%'
}
function turnoverBar(days) {
  if (days === null || days === undefined) return '100%'
  return Math.max(2, Math.min(100, (days / maxTurnover.value) * 100)).toFixed(1) + '%'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getInventoryMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取库存指标失败'
      items.value = []
      return
    }
    items.value = res.items || []
    summary.value = res.summary || {}
  } catch (e) {
    error.value = e && e.message ? e.message : '读取库存指标失败'
    items.value = []
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
  max-width: 760px;
}
.mod-desc strong {
  color: #c62828;
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
  font-size: 19px;
  color: #0d47a1;
}
.stat span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.stat.warn b {
  color: #c62828;
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
  gap: 12px;
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
  flex-shrink: 0;
}
.none {
  margin: 0;
  padding: 20px 0;
  font-size: 13px;
  color: #8a9099;
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
.th-wide {
  width: 150px;
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
.cell-name {
  color: #1d2129;
  font-weight: 500;
}
.cell-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #a8b0b8;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}
.abc-tag {
  display: inline-block;
  width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}
.abc-A {
  background: #e53935;
}
.abc-B {
  background: #fb8c00;
}
.abc-C {
  background: #78909c;
}
.bad {
  color: #c62828;
  font-weight: 500;
}
.advice {
  font-size: 12px;
  color: #5f6a75;
}
.bar-wrap {
  display: inline-block;
  width: 80px;
  height: 6px;
  background: #eef1f5;
  border-radius: 3px;
  overflow: hidden;
  vertical-align: middle;
}
.bar {
  height: 100%;
  background: #e53935;
  border-radius: 3px;
}
.bar-text {
  margin-left: 8px;
  font-size: 12px;
  color: #4a5158;
}
</style>

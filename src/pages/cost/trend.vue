<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">价格趋势</h2>
        <p class="mod-desc">按月看单个物料的加权均价走势，判断涨价是偶发波动还是持续上行。</p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <template v-if="items.length">
      <section class="filters">
        <label class="fl">物料
          <select v-model="selectedId">
            <option v-for="it in options" :key="it.materialId" :value="it.materialId">
              {{ it.code }} · {{ it.name }}
            </option>
          </select>
        </label>
        <span v-if="current" class="cur">
          基期 ¥{{ current.basePrice.toFixed(2) }} →
          本期 ¥{{ current.currentPrice.toFixed(2) }}
          <b :class="current.changePct > 0 ? 'bad' : current.changePct < 0 ? 'good' : ''">
            （{{ current.changePct >= 0 ? '+' : '' }}{{ (current.changePct * 100).toFixed(1) }}%）
          </b>
        </span>
      </section>

      <!-- 柱状趋势图（自绘，不引入图表库依赖） -->
      <section v-if="current && current.series.length" class="card">
        <div class="card-head">
          <h3 class="card-title">{{ current.name }} · 月度加权均价</h3>
          <span class="card-sub">共 {{ current.series.length }} 个有采购的月份</span>
        </div>
        <div class="chart">
          <div v-for="(p, i) in current.series" :key="p.period" class="col">
            <span class="col-val">{{ p.avgPrice.toFixed(2) }}</span>
            <div class="col-bar-wrap">
              <div
                class="col-bar"
                :class="i > 0 && p.avgPrice > current.series[i - 1].avgPrice ? 'up' : 'down'"
                :style="{ height: barHeight(p.avgPrice) }"
              ></div>
            </div>
            <span class="col-label">{{ p.period.slice(2) }}</span>
          </div>
        </div>
      </section>

      <!-- 逐月明细 -->
      <section v-if="current" class="card">
        <div class="card-head">
          <h3 class="card-title">逐月明细</h3>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>账期</th>
              <th>采购数量</th>
              <th>采购金额</th>
              <th>加权均价</th>
              <th>环比变化</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in current.series" :key="p.period">
              <td class="mono">{{ p.period }}</td>
              <td>{{ fmtNum(p.qty) }} {{ current.unit || '' }}</td>
              <td>¥{{ fmtNum(p.amount) }}</td>
              <td>¥{{ p.avgPrice.toFixed(2) }}</td>
              <td :class="momClass(i)">{{ momText(i) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup>
// 价格趋势：单物料的月度加权均价柱状图 + 逐月明细。
// 柱状图用 CSS 自绘，不引入图表库——保证页面在任何依赖状态下都能正常显示。
import { ref, computed, onMounted } from 'vue'
import { getCostMetrics } from '../../api'

const items = ref([])
const loading = ref(false)
const error = ref('')
const selectedId = ref(null)

// 下拉只列出有价格序列的物料（至少要跨越两个有采购的月份才有趋势可看）
const options = computed(() =>
  items.value.filter((it) => it.series && it.series.length >= 2)
)

const current = computed(() => options.value.find((it) => it.materialId === selectedId.value) || null)

// 柱高按序列最大值归一化
const maxPrice = computed(() => {
  const list = current.value ? current.value.series.map((p) => p.avgPrice) : []
  return Math.max(0.0001, ...list)
})

function barHeight(price) {
  return Math.max(4, Math.min(100, (price / maxPrice.value) * 100)).toFixed(1) + '%'
}

// 环比文案与配色
function momText(i) {
  const s = current.value.series
  if (i === 0) return '—'
  const prev = s[i - 1].avgPrice
  if (prev <= 0) return '—'
  const chg = (s[i].avgPrice - prev) / prev
  return (chg >= 0 ? '+' : '') + (chg * 100).toFixed(1) + '%'
}
function momClass(i) {
  const s = current.value.series
  if (i === 0) return ''
  const prev = s[i - 1].avgPrice
  if (prev <= 0) return ''
  const chg = (s[i].avgPrice - prev) / prev
  if (chg > 0.001) return 'bad'
  if (chg < -0.001) return 'good'
  return ''
}

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getCostMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取成本指标失败'
      items.value = []
      return
    }
    items.value = res.items || []
    // 默认选中涨幅最大的那个物料，打开页面就能看到问题所在
    const sorted = [...options.value].sort((a, b) => (b.changePct || 0) - (a.changePct || 0))
    selectedId.value = sorted.length ? sorted[0].materialId : null
  } catch (e) {
    error.value = e && e.message ? e.message : '读取成本指标失败'
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
  max-width: 280px;
}
.cur {
  margin-left: auto;
  font-size: 13px;
  color: #5f6a75;
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
  margin-bottom: 16px;
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

/* 自绘柱状图 */
.chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 190px;
  padding: 8px 0 0;
  overflow-x: auto;
}
.col {
  flex: 1 0 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.col-val {
  font-size: 10px;
  color: #8a9099;
  margin-bottom: 4px;
  white-space: nowrap;
}
.col-bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.col-bar {
  width: 60%;
  min-width: 12px;
  border-radius: 3px 3px 0 0;
  background: #90a4ae;
}
.col-bar.up {
  background: #e53935;
}
.col-bar.down {
  background: #43a047;
}
.col-label {
  margin-top: 6px;
  font-size: 10px;
  color: #a8b0b8;
  white-space: nowrap;
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
}
.tbl td {
  padding: 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.mono {
  font-family: Consolas, Monaco, monospace;
}
.bad {
  color: #c62828;
  font-weight: 500;
}
.good {
  color: #2e7d32;
  font-weight: 500;
}
</style>

<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">成本总览</h2>
        <p class="mod-desc">
          用加权均价口径对比各物料的基期与本期价格，回答「采购成本为什么降不下来」。
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <template v-if="items.length">
      <section class="stat-row">
        <div class="stat"><b>¥{{ fmtMoney(summary.totalAmount) }}</b><span>累计采购金额</span></div>
        <div class="stat"><b>{{ fmtIndex(summary.avgPriceIndex) }}</b><span>平均价格指数</span></div>
        <div class="stat warn"><b>{{ summary.risingCount }}</b><span>涨幅超 5% 的物料</span></div>
        <div class="stat"><b>{{ items.length }}</b><span>涉及物料</span></div>
      </section>

      <!-- 涨幅榜 -->
      <section v-if="topRisers.length" class="card">
        <div class="card-head">
          <h3 class="card-title">涨幅榜</h3>
          <span class="card-sub">价格指数 = 本期加权均价 ÷ 基期加权均价</span>
        </div>
        <div class="rank-list">
          <div v-for="it in topRisers" :key="it.materialId" class="rank-item">
            <span class="rank-name">{{ it.name }}</span>
            <div class="rank-bar-wrap">
              <div class="rank-bar" :style="{ width: riserWidth(it.changePct) }"></div>
            </div>
            <span class="rank-value">+{{ (it.changePct * 100).toFixed(1) }}%</span>
            <span class="rank-detail">¥{{ it.basePrice.toFixed(2) }} → ¥{{ it.currentPrice.toFixed(2) }}</span>
          </div>
        </div>
      </section>

      <!-- 明细 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">物料成本明细（按采购金额降序）</h3>
          <label class="chk"><input v-model="onlyRising" type="checkbox" />只看涨价的</label>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>物料</th>
              <th>ABC</th>
              <th>采购批次</th>
              <th>采购数量</th>
              <th>采购金额</th>
              <th>加权均价</th>
              <th>基期价</th>
              <th>本期价</th>
              <th>价格指数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in filtered" :key="it.materialId" :class="{ rising: it.changePct > 0.05 }">
              <td>
                <div class="cell-name">{{ it.name }}</div>
                <div class="cell-sub">{{ it.code }} · {{ it.category }}</div>
              </td>
              <td><span class="abc-tag small" :class="'abc-' + it.abcClass">{{ it.abcClass }}</span></td>
              <td>{{ it.orderCount }}</td>
              <td>{{ fmtNum(it.totalQty) }} {{ it.unit }}</td>
              <td>¥{{ fmtNum(it.totalAmount) }}</td>
              <td>¥{{ it.avgPrice.toFixed(2) }}</td>
              <td>¥{{ it.basePrice.toFixed(2) }}</td>
              <td>¥{{ it.currentPrice.toFixed(2) }}</td>
              <td :class="indexClass(it.changePct)">
                {{ fmtIndex(it.priceIndex) }}
                <span v-if="it.changePct !== null" class="pct">（{{ it.changePct >= 0 ? '+' : '' }}{{ (it.changePct * 100).toFixed(1) }}%）</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="footnote">
          加权均价 = 采购金额 ÷ 采购数量。这里刻意不对单价直接取平均——同一物料不同批次的采购量差异很大，
          直接平均会被小批量订单严重带偏。
        </p>
      </section>
    </template>
  </div>
</template>

<script setup>
// 成本总览：汇总卡 + 涨幅榜 + 物料成本明细。
// 价格指数以序列的第一个有采购的月份为基期、最后一个月为本期，反映累计涨幅。
import { ref, computed, onMounted } from 'vue'
import { getCostMetrics } from '../../api'

const items = ref([])
const summary = ref({})
const loading = ref(false)
const error = ref('')
const onlyRising = ref(false)

const topRisers = computed(() => summary.value.topRisers || [])
const maxRise = computed(() => Math.max(0.01, ...topRisers.value.map((it) => it.changePct)))

const filtered = computed(() => {
  const list = onlyRising.value ? items.value.filter((it) => it.changePct > 0) : items.value
  return [...list].sort((a, b) => b.totalAmount - a.totalAmount)
})

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
function fmtIndex(v) {
  return v === null || v === undefined ? '—' : Number(v).toFixed(3)
}
function riserWidth(pct) {
  return Math.max(4, Math.min(100, (pct / maxRise.value) * 100)).toFixed(1) + '%'
}
// 价格指数按国内习惯：涨为红、跌为绿
function indexClass(pct) {
  if (pct === null || pct === undefined) return ''
  if (pct > 0.05) return 'bad'
  if (pct < -0.05) return 'good'
  return ''
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
    summary.value = res.summary || {}
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
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4a5158;
  cursor: pointer;
  flex-shrink: 0;
}

/* 涨幅榜 */
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rank-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.rank-name {
  width: 130px;
  flex-shrink: 0;
  color: #1d2129;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-bar-wrap {
  flex: 1;
  height: 10px;
  background: #f2f4f7;
  border-radius: 5px;
  overflow: hidden;
}
.rank-bar {
  height: 100%;
  background: #e53935;
  border-radius: 5px;
}
.rank-value {
  width: 66px;
  text-align: right;
  color: #c62828;
  font-weight: 600;
  flex-shrink: 0;
}
.rank-detail {
  width: 170px;
  text-align: right;
  font-size: 12px;
  color: #8a9099;
  flex-shrink: 0;
}

/* 表格 */
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
  white-space: nowrap;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.tbl tr.rising {
  background: #fffafa;
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
.good {
  color: #2e7d32;
}
.pct {
  font-size: 11px;
  font-weight: 400;
}
.footnote {
  margin: 14px 0 0;
  font-size: 12px;
  color: #a8b0b8;
  line-height: 1.8;
}
</style>

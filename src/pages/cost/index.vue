<template>
  <LandingPage
    title="采购成本"
    desc="回答「采购成本为什么降不下来」。价格有波动是正常的，真正值得追问的是：
          有没有哪类物料在持续涨价、涨了多少、是偶发波动还是趋势性上行。"
    :stats="stats"
    :entries="entries"
    :notes="notes"
    :error="error"
  />
</template>

<script setup>
// 采购成本 —— 模块落地页：说明 + 速览 + 快捷入口 + 口径说明。
import { ref, onMounted } from 'vue'
import LandingPage from '../../components/module-landing/LandingPage.vue'
import { getCostMetrics } from '../../api'

const error = ref('')
const stats = ref([])

const entries = [
  {
    key: 'cost-overview',
    title: '成本总览',
    desc: '累计采购金额、涨幅榜，以及逐物料的加权均价与价格指数对比，按采购金额降序排列。'
  },
  {
    key: 'cost-trend',
    title: '价格趋势',
    desc: '按月看单个物料的加权均价走势与环比变化，判断涨价是偶发波动还是持续上行。'
  }
]

const notes = [
  '加权均价 = 采购金额 ÷ 采购数量。这里刻意不对单价直接取平均——同一物料不同批次的采购量差异很大，直接平均会被小批量试单严重带偏。',
  '价格指数 = 本期加权均价 ÷ 基期加权均价。基期取序列中第一个有采购的月份，本期取最后一个，反映的是累计涨幅。',
  '趋势判断只使用「有采购发生」的月份，不会为没有订单的月份凭空造出一个均价。',
  '预警线：价格指数高于 1.10（即累计涨幅超过 10%），或单价连续 3 个月上涨且累计涨幅超过 5%。'
]

function fmtMoney(v) {
  const n = Number(v) || 0
  if (n >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}

onMounted(async () => {
  try {
    const res = await getCostMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取成本指标失败'
      return
    }
    const s = res.summary || {}
    stats.value = [
      { label: '累计采购金额', value: fmtMoney(s.totalAmount) },
      { label: '平均价格指数', value: s.avgPriceIndex === null || s.avgPriceIndex === undefined ? '—' : Number(s.avgPriceIndex).toFixed(3) },
      { label: '涨幅超 5% 的物料', value: s.risingCount || 0, tone: s.risingCount > 0 ? 'warn' : 'ok' },
      { label: '涉及物料', value: s.materialCount || 0 }
    ]
  } catch (e) {
    error.value = e && e.message ? e.message : '读取成本指标失败'
  }
})
</script>

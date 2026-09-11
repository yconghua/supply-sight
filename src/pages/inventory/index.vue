<template>
  <LandingPage
    title="库存健康度"
    desc="回答「库存压了多少钱」。库存本身不是问题，压住资金、又不参与周转的库存才是问题。
          这里把库存拆成「占用了多少资金」和「周转速度」两个视角，找出真正压在仓库里动不了的那部分。"
    :stats="stats"
    :entries="entries"
    :notes="notes"
    :error="error"
  />
</template>

<script setup>
// 库存健康度 —— 模块落地页：说明 + 速览 + 快捷入口 + 口径说明。
import { ref, onMounted } from 'vue'
import LandingPage from '../../components/module-landing/LandingPage.vue'
import { getInventoryMetrics } from '../../api'

const error = ref('')
const stats = ref([])

const entries = [
  {
    key: 'inventory-overview',
    title: '库存总览',
    desc: '期末库存金额、ABC 分类的资金分布、逐物料的库存与周转情况，按金额降序排列。'
  },
  {
    key: 'inventory-dead',
    title: '呆滞与周转',
    desc: '把「周转慢且长期无人领用」的物料挑出来，附处置建议，并给出全部物料的周转天数排行。'
  }
]

const notes = [
  '库存金额 = 期末数量 × 期末单价。单价按移动加权平均法维护，入库时摊薄、出库时按当时均价计价。',
  '周转天数 = 统计期天数 ÷（期间出库金额 ÷ 平均库存金额）。它回答的是「按当前消耗速度，这批库存还能用多久」。',
  'ABC 分类按年消耗金额的帕累托分布划分：累计占 80% 为 A 类、95% 为 B 类、其余为 C 类。',
  '呆滞判定用组合条件：周转天数超过 180 天「且」连续 60 天没有出库。只看周转慢会误杀正常慢销品，加上无出库这一条才站得住。'
]

function fmtMoney(v) {
  const n = Number(v) || 0
  if (n >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}

onMounted(async () => {
  try {
    const res = await getInventoryMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取库存指标失败'
      return
    }
    const s = res.summary || {}
    stats.value = [
      { label: '期末库存金额', value: fmtMoney(s.totalAmount) },
      { label: '其中呆滞占用', value: fmtMoney(s.deadAmount), tone: s.deadAmount > 0 ? 'warn' : 'ok' },
      { label: '平均周转天数', value: s.avgTurnoverDays === null || s.avgTurnoverDays === undefined ? '—' : Math.round(s.avgTurnoverDays) + ' 天' },
      { label: '呆滞物料数', value: s.deadCount || 0, tone: s.deadCount > 0 ? 'warn' : 'ok' }
    ]
  } catch (e) {
    error.value = e && e.message ? e.message : '读取库存指标失败'
  }
})
</script>

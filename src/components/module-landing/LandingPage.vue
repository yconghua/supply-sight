<template>
  <div class="landing">
    <!-- 模块说明：这个导航栏是干什么的 -->
    <section class="hero">
      <h2 class="hero-title">{{ title }}</h2>
      <p class="hero-desc">{{ desc }}</p>
    </section>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- 数据速览：进来先看一眼关键数字 -->
    <section v-if="stats.length" class="stat-row">
      <div v-for="(s, i) in stats" :key="i" class="stat" :class="s.tone">
        <b>{{ s.value }}</b>
        <span>{{ s.label }}</span>
      </div>
    </section>

    <!-- 快捷入口：进入本模块的具体页面 -->
    <section class="entries">
      <RouterLink v-for="e in entries" :key="e.key" :to="'/' + e.key" class="entry">
        <div class="entry-head">
          <span class="entry-title">{{ e.title }}</span>
          <span class="entry-arrow">›</span>
        </div>
        <p class="entry-desc">{{ e.desc }}</p>
      </RouterLink>
    </section>

    <!-- 口径说明：这个模块看什么、指标怎么算的 -->
    <section v-if="notes.length" class="notes">
      <h3 class="notes-title">这个模块看什么</h3>
      <ul class="notes-list">
        <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
      </ul>
    </section>
  </div>
</template>

<script setup>
// 模块落地页通用展示组件。
// 大导航被点击后进入的就是这一层：先解释这个模块解决什么问题、关键数字是多少，
// 再由「快捷入口」把用户送去具体的功能页——而不是直接把第一个子页的内容顶上来。
// 四个模块的落地页共用本组件，各自只提供文案与数据。
defineProps({
  /** 模块标题（与导航名称一致） */
  title: { type: String, default: '' },
  /** 一句话说明这个模块回答什么业务问题 */
  desc: { type: String, default: '' },
  /** 数据速览：[{ label, value, tone }]，tone 可选 warn 表示告警色 */
  stats: { type: Array, default: () => [] },
  /** 快捷入口：[{ key, title, desc }]，key 为子导航 key（路由 path） */
  entries: { type: Array, default: () => [] },
  /** 口径说明：字符串数组 */
  notes: { type: Array, default: () => [] },
  /** 加载失败提示 */
  error: { type: String, default: '' }
})
</script>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 模块说明 */
.hero {
  border-radius: 14px;
  background: linear-gradient(135deg, #0d47a1 0%, #1976d2 100%);
  padding: 26px 30px;
  color: #fff;
}
.hero-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.hero-desc {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.92);
  max-width: 860px;
}

.err {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #c62828;
  background: #fdecea;
  border-radius: 10px;
}

/* 数据速览 */
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.stat {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 18px 16px;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.stat b {
  display: block;
  font-size: 21px;
  color: #0d47a1;
  font-weight: 700;
}
.stat span {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #8a9099;
}
.stat.warn b {
  color: #c62828;
}
.stat.ok b {
  color: #2e7d32;
}

/* 快捷入口 */
.entries {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}
.entry {
  display: block;
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 18px 22px;
  text-decoration: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: all 0.18s;
}
.entry:hover {
  border-color: #cfe0f5;
  box-shadow: 0 6px 20px rgba(13, 71, 161, 0.1);
  transform: translateY(-1px);
}
.entry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.entry-title {
  font-size: 15px;
  font-weight: 600;
  color: #1d2129;
}
.entry-arrow {
  font-size: 18px;
  color: #b6c2d1;
  line-height: 1;
}
.entry:hover .entry-arrow {
  color: #0d47a1;
}
.entry-desc {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8a9099;
  line-height: 1.8;
}

/* 口径说明 */
.notes {
  background: #f7f9fc;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  padding: 18px 24px;
}
.notes-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #1d2129;
}
.notes-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: #4a5158;
  line-height: 1.9;
}
.notes-list li {
  margin-bottom: 4px;
}
</style>

/**
 * 随机数底座（数据模拟器基础层）
 *
 * 为什么不用 Math.random()：
 *   模拟器的核心承诺是「同一个随机种子，两次生成的数据完全一致」。
 *   Math.random() 无法指定种子、也无法复现，做不到这件事。
 *   因此这里用 mulberry32 实现一个可指定种子的伪随机数生成器：
 *   同一种子必然产生同一条随机数序列。
 *
 * 为什么正态分布要自己写：
 *   JS 标准库没有正态分布。Box-Muller 变换能把两个均匀分布随机数
 *   转换成一对标准正态分布随机数，实现简单、精度足够，
 *   正好对应「用正态分布模拟供应商交付水平」这一需求。
 */

/**
 * 创建一个 mulberry32 伪随机数生成器。
 * @param {number} seed 随机种子（任意整数，会用 32 位无符号口径解释）
 * @returns {Function} 每调用一次返回 [0, 1) 区间的随机数
 */
function createRandom(seed) {
  // 用 >>> 0 把种子规范成 32 位无符号整数，避免负数种子在不同平台上解释不一致
  let t = seed >>> 0
  return function random() {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 基于给定的均匀随机源构造正态分布采样函数（Box-Muller 变换）。
 * @param {Function} random 均匀分布随机数生成器（createRandom 的返回值）
 * @returns {Function} normal(mean, stdDev) → 服从 N(mean, stdDev²) 的样本
 */
function createNormal(random) {
  return function normal(mean = 0, stdDev = 1) {
    // u、v 都不能为 0：log(0) 会得到 -Infinity，故循环重取
    let u = 0
    let v = 0
    while (u === 0) u = random()
    while (v === 0) v = random()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return mean + stdDev * z
  }
}

/**
 * 取 [min, max] 闭区间内的整数（均匀分布）
 * @param {Function} random 均匀随机源
 * @param {number} min 下界（含）
 * @param {number} max 上界（含）
 */
function randInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min
}

/**
 * 取 [min, max] 区间内的浮点数（均匀分布）
 * @param {Function} random 均匀随机源
 */
function randFloat(random, min, max) {
  return random() * (max - min) + min
}

/**
 * 从数组中等概率取一个元素
 * @param {Function} random 均匀随机源
 * @param {Array} list 候选数组（非空）
 */
function pickOne(random, list) {
  return list[Math.floor(random() * list.length)]
}

/**
 * 保留两位小数。
 * 一方面消除浮点累加误差（如 0.1 + 0.2），
 * 另一方面与数据库 DECIMAL(…,2) 字段的精度对齐，避免写入时被静默截断。
 */
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

/** 保留四位小数（单价字段用，对应 DECIMAL(12,4)） */
function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}

/** 把数值限制在 [min, max] 区间内 */
function clamp(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

module.exports = {
  createRandom,
  createNormal,
  randInt,
  randFloat,
  pickOne,
  round2,
  round4,
  clamp
}

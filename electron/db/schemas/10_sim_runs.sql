-- 数据模拟运行记录表：让「数据是造出来的」这件事本身可追溯、可复现
-- 为什么单独存一张表：
--   1. seed 落库后，「同一种子两次生成结果完全一致」这句话才有据可查，页面可展示生成历史；
--   2. profile 记录本次的埋点配置（哪几家供应商高延迟、哪些物料故意造成呆滞、哪类物料价格带正漂移），
--      演示时可以直接回答「这个坑是你故意埋的还是碰巧出来的」；
--   3. selfcheck 存 5 项勾稽自检结果，页面上一眼能看到数据是否平。
-- row_counts 存各表实际写入条数（JSON），用于和预期规模核对。
CREATE TABLE IF NOT EXISTS `sim_run` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `run_no`         VARCHAR(40)   NOT NULL                COMMENT '本次运行编号（唯一）',
  `seed`           INT UNSIGNED  NOT NULL                COMMENT '随机种子（同种子生成结果可复现）',
  `material_count` INT           NOT NULL DEFAULT 0      COMMENT '生成物料数',
  `supplier_count` INT           NOT NULL DEFAULT 0      COMMENT '生成供应商数',
  `start_date`     DATE          NOT NULL                COMMENT '模拟起始日期',
  `end_date`       DATE          NOT NULL                COMMENT '模拟结束日期',
  `profile`        JSON          DEFAULT NULL            COMMENT '埋点配置（供应商交付参数 / 呆滞物料 / 价格漂移）',
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'running' COMMENT '状态：running 生成中 / success 成功 / failed 失败',
  `selfcheck`      JSON          DEFAULT NULL            COMMENT '勾稽自检结果（5 项）',
  `row_counts`     JSON          DEFAULT NULL            COMMENT '各业务表实际写入条数',
  `message`        VARCHAR(255)  NOT NULL DEFAULT ''     COMMENT '失败原因或补充说明',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  `finished_at`    DATETIME      DEFAULT NULL            COMMENT '结束时间（进行中为 NULL）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sim_run_no` (`run_no`),
  KEY `idx_sim_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据模拟运行记录表';

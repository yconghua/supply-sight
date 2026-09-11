-- 预警记录表：规则引擎每次扫描命中的结果落在这里，预警中心页面读这张表
-- 去重策略：唯一键 (rule_code, target_type, target_id, period) ——
--   同一规则对同一对象的同一账期只保留一条记录，重复扫描时更新实测值而不新增，
--   既避免预警越扫越多，也让「这条预警是哪期触发的」始终可追溯。
-- target_name 是冗余字段：列表页要直接展示供应商 / 物料名称，避免每次都回表联查。
CREATE TABLE IF NOT EXISTS `alert_record` (
  `id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `rule_code`       VARCHAR(40)   NOT NULL                COMMENT '命中的规则编码（逻辑关联 alert_rule.code）',
  `module`          VARCHAR(20)   NOT NULL                COMMENT '所属模块：supplier / inventory / cost',
  `target_type`     VARCHAR(20)   NOT NULL                COMMENT '对象类型：supplier 供应商 / material 物料',
  `target_id`       INT UNSIGNED  NOT NULL                COMMENT '对象 ID',
  `target_name`     VARCHAR(100)  NOT NULL DEFAULT ''     COMMENT '对象名称（冗余，便于列表展示）',
  `period`          VARCHAR(10)   NOT NULL DEFAULT ''     COMMENT '触发账期，格式 YYYY-MM 或 YYYY-MM-DD',
  `metric_value`    DECIMAL(16,4) NOT NULL DEFAULT 0.0000 COMMENT '指标实测值',
  `threshold_value` DECIMAL(16,4) NOT NULL DEFAULT 0.0000 COMMENT '规则阈值（便于页面直接展示对比）',
  `severity`        VARCHAR(10)   NOT NULL DEFAULT 'medium' COMMENT '严重度：high / medium / low',
  `status`          VARCHAR(20)   NOT NULL DEFAULT 'open' COMMENT '处理状态：open 未处理 / resolved 已处理 / ignored 已忽略',
  `message`         VARCHAR(255)  NOT NULL DEFAULT ''     COMMENT '预警描述（含实测值与阈值的白话说明）',
  `triggered_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '触发时间',
  `handled_at`      DATETIME      DEFAULT NULL            COMMENT '处理时间（未处理为 NULL）',
  `remark`          VARCHAR(255)  NOT NULL DEFAULT ''     COMMENT '处理备注',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alert_dedup` (`rule_code`, `target_type`, `target_id`, `period`),
  KEY `idx_alert_status` (`status`),
  KEY `idx_alert_module` (`module`),
  KEY `idx_alert_severity` (`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预警记录表';

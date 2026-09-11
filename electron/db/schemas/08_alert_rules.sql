-- 预警规则表：轻量规则引擎的配置来源（JSON 参数存库，页面只读展示）
-- 三类规则统一由 params 里的 JSON 描述，引擎按 type 分派求值器：
--   threshold 阈值型：params = {"metric":"...","op":"<|>|<=|>=","value":数值,"window_months":可选}
--   trend     趋势型：params = {"metric":"...","direction":"up|down","periods":连续期数,"min_change_pct":可选}
--   composite 组合型：params = {"logic":"and|or","conditions":[{同阈值型结构}, ...]}
-- metric 存该规则关注的主指标键，便于按指标检索与分组。
-- 种子数据用 INSERT IGNORE：借 uk_rule_code 保证重复执行（版本升级会重跑初始化）不产生重复规则，
-- 同时不会覆盖用户已改过的阈值。
CREATE TABLE IF NOT EXISTS `alert_rule` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code`        VARCHAR(40)   NOT NULL                COMMENT '规则编码（唯一）',
  `name`        VARCHAR(100)  NOT NULL                COMMENT '规则名称',
  `module`      VARCHAR(20)   NOT NULL                COMMENT '所属模块：supplier 供应商 / inventory 库存 / cost 成本',
  `type`        VARCHAR(20)   NOT NULL                COMMENT '规则类型：threshold 阈值 / trend 趋势 / composite 组合',
  `metric`      VARCHAR(40)   NOT NULL                COMMENT '主指标键',
  `params`      JSON          DEFAULT NULL            COMMENT '规则参数（阈值 / 窗口 / 多条件组合）',
  `severity`    VARCHAR(10)   NOT NULL DEFAULT 'medium' COMMENT '严重度：high / medium / low',
  `enabled`     TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '是否启用：1 启用 / 0 停用',
  `description` VARCHAR(255)  NOT NULL DEFAULT ''     COMMENT '规则说明（面向业务人员的白话解释）',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rule_code` (`code`),
  KEY `idx_rule_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预警规则表';

-- 默认规则种子（6 条，覆盖三类规则与三个业务模块）
INSERT IGNORE INTO `alert_rule`
  (`code`, `name`, `module`, `type`, `metric`, `params`, `severity`, `enabled`, `description`)
VALUES
  ('SUP_OTD_LOW', '供应商准时交付率过低', 'supplier', 'threshold', 'otd_rate',
   '{"metric":"otd_rate","op":"<","value":0.9,"window_months":3}', 'high', 1,
   '近 3 个月准时交付率低于 90%，说明该供应商的交付可靠性不达标'),
  ('SUP_PPM_HIGH', '供应商来料不良率偏高', 'supplier', 'threshold', 'ppm',
   '{"metric":"ppm","op":">","value":5000,"window_months":3}', 'high', 1,
   '近 3 个月来料不良率超过 5000 PPM，来料质量需要整改'),
  ('INV_TURNOVER_SLOW', '库存周转天数超标', 'inventory', 'threshold', 'turnover_days',
   '{"metric":"turnover_days","op":">","value":180}', 'medium', 1,
   '物料周转天数超过 180 天，资金占用偏高'),
  ('INV_DEAD_STOCK', '呆滞库存预警', 'inventory', 'composite', 'turnover_days',
   '{"logic":"and","conditions":[{"metric":"turnover_days","op":">","value":180},{"metric":"idle_days","op":">","value":60}]}', 'high', 1,
   '周转天数超过 180 天且近 60 天无出库，两个条件同时满足才判为呆滞（避免误杀正常慢销品）'),
  ('COST_PRICE_RISING', '采购单价持续上涨', 'cost', 'trend', 'unit_price',
   '{"metric":"unit_price","direction":"up","periods":3,"min_change_pct":0.05}', 'medium', 1,
   '物料采购单价连续 3 个月上涨且累计涨幅超过 5%，是成本降不下来的直接原因'),
  ('COST_INDEX_HIGH', '采购价格指数偏高', 'cost', 'threshold', 'price_index',
   '{"metric":"price_index","op":">","value":1.1}', 'medium', 1,
   '本期加权采购均价比基期高出 10% 以上');

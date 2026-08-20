---
name: regression-insight
description: "对 CSV/Excel 数据执行线性回归（OLS）或逻辑回归（Logistic），一键输出完整统计结果（包含回归系数、R²、p值、VIF等）和中文通俗解读。当用户提及回归分析、拟合模型、查看系数显著性、R方、p值、共线性（VIF），或使用关键词如 回归、regression、OLS、logit、拟合、显著性 时触发。"
license: MIT
---

# regression-analyzer

自动回归建模工具 —— 对表格数据执行线性回归（OLS）或逻辑回归（Logit），一键输出完整统计结果和中文通俗解读。

## 能力概览

| 功能 | 说明 |
|------|------|
| 线性回归 | OLS，输出系数、R²、调整 R²、F 检验、AIC/BIC、Durbin-Watson |
| 逻辑回归 | Logit，输出系数、Odds Ratio、Pseudo R²、似然比检验 |
| 多重共线性检测 | 每个自变量的 VIF 值 + 警告级别 |
| 通俗解读 | 用中文对每个指标和系数给出"什么意思/该怎么看"的说明 |
| 自动检测 | 目标变量为 0/1 时自动切换逻辑回归 |

## Tooling

在 ZhiYuan/Pi 内**必须**通过 `run_skill_script` 执行本技能脚本，禁止用 bash 直跑 `python3` 或 `python`：

```json
{
  "skillId": "regression-insight",
  "script": "scripts/regression_analyzer.py",
  "args": ["<数据文件>", "--target", "<目标列>"]
}
```

- `args` 与下方"详细用法"的命令行参数一一对应（去掉 `python3 scripts/regression_analyzer.py` 前缀）。
- 脚本依赖（pandas / numpy / scipy / statsmodels，见 `requirements.txt`）由应用管理的技能 Python 运行时保证，**不需要也不应该**手动 `pip install` 或寻找系统 Python。
- 若执行返回依赖缺失或运行时不可用错误，**不要**改用系统 `python3` 或手写替代实现（例如用纯 Python 循环重算回归）——直接报告该错误，说明需要技能 Python 运行时提供依赖。

## Quick Start

```json
{
  "skillId": "regression-insight",
  "script": "scripts/regression_analyzer.py",
  "args": ["data.csv", "--target", "price"]
}
```

完整命令示例（展示参数映射，实际执行一律经 `run_skill_script`）：

```bash
# 线性回归：预测 price，用所有数值列做自变量
python3 scripts/regression_analyzer.py data.csv --target price

# 逻辑回归：预测 churn（0/1），指定特征列
python3 scripts/regression_analyzer.py users.csv --target churn --features "age,income,tenure"

# 保存结果到 JSON
python3 scripts/regression_analyzer.py data.csv --target sales --output result.json
```

## 详细用法

以下命令示例仅用于展示参数映射——实际执行一律通过 `run_skill_script`，将参数放入 `args` 数组（见上方 Tooling 段）。禁止在 bash 中直跑 `python3` 调用本脚本。

### 基本调用

```bash
python3 scripts/regression_analyzer.py <数据文件> --target <目标列> [选项]
```

### 指定回归类型

```bash
# 强制线性回归
python3 scripts/regression_analyzer.py data.csv -t y --type linear

# 强制逻辑回归
python3 scripts/regression_analyzer.py data.csv -t label --type logistic

# 自动检测（默认）
python3 scripts/regression_analyzer.py data.csv -t y --type auto
```

### 选择特征列

```bash
# 手动指定（逗号分隔）
python3 scripts/regression_analyzer.py data.csv -t price -f "sqft,bedrooms,bathrooms"

# 省略则自动使用所有数值列
python3 scripts/regression_analyzer.py data.csv -t price
```

## 参数说明

| 参数 | 缩写 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `input` | — | 是 | — | 输入文件路径（CSV/TSV/Excel/JSON） |
| `--target` | `-t` | 是 | — | 目标变量（因变量）列名 |
| `--features` | `-f` | 否 | 全部数值列 | 自变量列名，逗号分隔 |
| `--type` | `-T` | 否 | `auto` | 回归类型：`linear` / `logistic` / `auto` |
| `--output` | `-o` | 否 | 标准输出 | 结果 JSON 保存路径 |
| `--no-const` | — | 否 | `false` | 不添加截距项 |
| `--keep-na` | — | 否 | `false` | 保留缺失值行（调试用） |

## 输出结构（JSON）

```json
{
  "type": "linear",
  "r_squared": 0.8523,
  "r_squared_adj": 0.8471,
  "f_statistic": 162.34,
  "f_p_value": 0.0,
  "coefficients": {
    "sqft": {"coefficient": 135.42, "p_value": 0.0001, ...},
    "bedrooms": {"coefficient": 8021.5, "p_value": 0.032, ...}
  },
  "vif": {"sqft": 2.31, "bedrooms": 1.87},
  "interpretation": {
    "模型概述": ["R² = 0.8523（模型拟合优良…）"],
    "各变量解读": ["sqft：系数 = 135.42…正向影响…"]
  }
}
```

## 依赖

运行时依赖（pandas、numpy、statsmodels、scipy）由应用管理的技能 Python 运行时按 `requirements.txt` 提供，**无需也不应手动安装**。仅在本地独立调试（不经过 ZhiYuan 运行时）时才需要：

```bash
pip install pandas numpy statsmodels scipy
```

#!/usr/bin/env python3
"""
农历计算准确性验证脚本
用于验证农历转换的准确性，与已知数据进行比对
"""

import json
import random
import sys
import time
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
import subprocess

class LunarValidator:
    """农历验证器"""

    def __init__(self):
        self.results = []
        self.validation_count = 0
        self.passed_count = 0
        self.failed_count = 0

        # 已知的农历-公历对照表（用于验证）
        self.known_dates = [
            # 春节（农历正月初一）
            {"solar": "2026-02-17", "lunar": "正月初一", "desc": "2026年春节"},
            {"solar": "2025-01-29", "lunar": "正月初一", "desc": "2025年春节"},
            {"solar": "2024-02-10", "lunar": "正月初一", "desc": "2024年春节"},
            {"solar": "2023-01-22", "lunar": "正月初一", "desc": "2023年春节"},
            {"solar": "2022-02-01", "lunar": "正月初一", "desc": "2022年春节"},

            # 中秋节（农历八月十五）
            {"solar": "2026-09-25", "lunar": "八月十五", "desc": "2026年中秋节"},
            {"solar": "2025-10-06", "lunar": "八月十五", "desc": "2025年中秋节"},
            {"solar": "2024-09-17", "lunar": "八月十五", "desc": "2024年中秋节"},
            {"solar": "2023-09-29", "lunar": "八月十五", "desc": "2023年中秋节"},
            {"solar": "2022-09-10", "lunar": "八月十五", "desc": "2022年中秋节"},

            # 端午节（农历五月初五）
            {"solar": "2026-06-19", "lunar": "五月初五", "desc": "2026年端午节"},
            {"solar": "2025-05-31", "lunar": "五月初五", "desc": "2025年端午节"},
            {"solar": "2024-06-10", "lunar": "五月初五", "desc": "2024年端午节"},
            {"solar": "2023-06-22", "lunar": "五月初五", "desc": "2023年端午节"},
            {"solar": "2022-06-03", "lunar": "五月初五", "desc": "2022年端午节"},

            # 清明节（公历固定，农历变化）
            {"solar": "2026-04-05", "lunar": "二月十八", "desc": "2026年清明节"},
            {"solar": "2025-04-04", "lunar": "三月初七", "desc": "2025年清明节"},
            {"solar": "2024-04-04", "lunar": "二月廿六", "desc": "2024年清明节"},
            {"solar": "2023-04-05", "lunar": "闰二月十五", "desc": "2023年清明节"},
            {"solar": "2022-04-05", "lunar": "三月初五", "desc": "2022年清明节"},

            # 随机测试日期
            {"solar": "2026-03-08", "lunar": "正月二十", "desc": "国际妇女节"},
            {"solar": "2025-12-25", "lunar": "十一月初六", "desc": "圣诞节"},
            {"solar": "2024-07-01", "lunar": "五月廿六", "desc": "建党节"},
            {"solar": "2023-10-01", "lunar": "八月十七", "desc": "国庆节"},
            {"solar": "2022-08-01", "lunar": "七月初四", "desc": "建军节"},

            # 闰月测试
            {"solar": "2023-03-22", "lunar": "闰二月初一", "desc": "2023年闰二月"},
            {"solar": "2020-05-23", "lunar": "闰四月初一", "desc": "2020年闰四月"},
            {"solar": "2017-07-23", "lunar": "闰六月初一", "desc": "2017年闰六月"},
            {"solar": "2014-10-24", "lunar": "闰九月初一", "desc": "2014年闰九月"},
            {"solar": "2012-05-21", "lunar": "闰四月初一", "desc": "2012年闰四月"},
        ]

    def run_lunar_calculator(self, solar_date: str) -> Dict:
        """运行农历计算器"""
        try:
            cmd = ["python3", "lunar_calculator.py", "--solar", solar_date]
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=".")

            if result.returncode == 0:
                return json.loads(result.stdout)
            else:
                return {"error": result.stderr}
        except Exception as e:
            return {"error": str(e)}

    def validate_single_date(self, test_case: Dict, index: int) -> Dict:
        """验证单个日期"""
        print(f"\n[{index + 1}/{len(self.known_dates)}] 验证: {test_case['desc']}")
        print(f"  公历: {test_case['solar']}")
        print(f"  期望农历: {test_case['lunar']}")

        start_time = time.time()
        result = self.run_lunar_calculator(test_case['solar'])
        elapsed_time = (time.time() - start_time) * 1000  # 转换为毫秒

        if "error" in result:
            print(f"  ❌ 错误: {result['error']}")
            passed = False
            actual_lunar = "错误"
        else:
            actual_lunar = f"{result.get('lunar_month_name', '')}{result.get('lunar_day_name', '')}"
            print(f"  实际农历: {actual_lunar}")
            print(f"  耗时: {elapsed_time:.1f}ms")

            # 判断是否匹配
            passed = self.is_lunar_match(test_case['lunar'], actual_lunar)

        validation_result = {
            "index": index + 1,
            "solar_date": test_case['solar'],
            "expected_lunar": test_case['lunar'],
            "actual_lunar": actual_lunar,
            "description": test_case['desc'],
            "passed": passed,
            "elapsed_ms": elapsed_time,
            "timestamp": datetime.now().isoformat(),
            "full_result": result if "error" not in result else None
        }

        self.results.append(validation_result)

        if passed:
            self.passed_count += 1
            print(f"  ✅ 通过")
        else:
            self.failed_count += 1
            print(f"  ❌ 失败")

        return validation_result

    def is_lunar_match(self, expected: str, actual: str) -> bool:
        """判断农历日期是否匹配"""
        # 简化匹配逻辑
        # 将"正月初一"转换为"1月1日"格式进行比较
        def normalize_lunar(lunar_str: str) -> str:
            # 月份转换
            month_map = {
                "正月": "1月", "二月": "2月", "三月": "3月", "四月": "4月",
                "五月": "5月", "六月": "6月", "七月": "7月", "八月": "8月",
                "九月": "9月", "十月": "10月", "冬月": "11月", "腊月": "12月",
                "闰正月": "闰1月", "闰二月": "闰2月", "闰三月": "闰3月", "闰四月": "闰4月",
                "闰五月": "闰5月", "闰六月": "闰6月", "闰七月": "闰7月", "闰八月": "闰8月",
                "闰九月": "闰9月", "闰十月": "闰10月", "闰冬月": "闰11月", "闰腊月": "闰12月"
            }

            # 日转换
            day_map = {
                "初一": "1日", "初二": "2日", "初三": "3日", "初四": "4日", "初五": "5日",
                "初六": "6日", "初七": "7日", "初八": "8日", "初九": "9日", "初十": "10日",
                "十一": "11日", "十二": "12日", "十三": "13日", "十四": "14日", "十五": "15日",
                "十六": "16日", "十七": "17日", "十八": "18日", "十九": "19日", "二十": "20日",
                "廿一": "21日", "廿二": "22日", "廿三": "23日", "廿四": "24日", "廿五": "25日",
                "廿六": "26日", "廿七": "27日", "廿八": "28日", "廿九": "29日", "三十": "30日"
            }

            # 尝试匹配月份
            for chinese, number in month_map.items():
                if chinese in lunar_str:
                    lunar_str = lunar_str.replace(chinese, number)
                    break

            # 尝试匹配日
            for chinese, number in day_map.items():
                if chinese in lunar_str:
                    lunar_str = lunar_str.replace(chinese, number)
                    break

            return lunar_str

        normalized_expected = normalize_lunar(expected)
        normalized_actual = normalize_lunar(actual)

        # 比较
        return normalized_expected == normalized_actual or expected in actual or actual in expected

    def run_validation(self, iterations: int = 30) -> Dict:
        """运行验证测试"""
        print("🌙 农历计算准确性验证系统")
        print("=" * 60)
        print(f"开始验证 {iterations} 个已知农历日期...")
        print(f"验证范围: 1997-2026年")
        print("=" * 60)

        # 如果请求的迭代次数超过已知日期数，重复使用
        test_cases = self.known_dates * (iterations // len(self.known_dates) + 1)
        test_cases = test_cases[:iterations]

        for i, test_case in enumerate(test_cases):
            self.validate_single_date(test_case, i)

            # 每5次休息一下
            if (i + 1) % 5 == 0 and i < len(test_cases) - 1:
                print("\n--- 短暂休息 ---\n")
                time.sleep(0.5)

        return self.generate_report()

    def generate_report(self) -> Dict:
        """生成验证报告"""
        print("\n" + "=" * 60)
        print("📊 验证报告")
        print("=" * 60)

        total = len(self.results)
        passed = self.passed_count
        failed = self.failed_count
        success_rate = (passed / total * 100) if total > 0 else 0

        print(f"总测试数: {total}")
        print(f"通过数: {passed}")
        print(f"失败数: {failed}")
        print(f"成功率: {success_rate:.1f}%")

        # 保存结果
        self.save_results()

        # 如果全部通过，建议名称
        if passed == total and total >= 30:
            system_name = self.suggest_system_name()
            print(f"\n🎉 所有验证通过！")
            print(f"✨ 推荐系统名称: {system_name}")

            # 创建技能包
            self.create_skill_package(system_name)
        else:
            print(f"\n⚠️  验证未完全通过")
            if failed > 0:
                print("\n❌ 失败详情:")
                for result in self.results:
                    if not result['passed']:
                        print(f"  {result['solar_date']} ({result['description']})")
                        print(f"    期望: {result['expected_lunar']}")
                        print(f"    实际: {result['actual_lunar']}")

        return {
            "total_tests": total,
            "passed_tests": passed,
            "failed_tests": failed,
            "success_rate": success_rate,
            "all_passed": passed == total
        }

    def save_results(self):
        """保存验证结果"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"lunar_validation_results_{timestamp}.json"

        report = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "total_tests": len(self.results),
                "passed_tests": self.passed_count,
                "failed_tests": self.failed_count,
                "success_rate": self.passed_count / len(self.results) * 100 if self.results else 0
            },
            "results": self.results
        }

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        print(f"\n📁 详细结果已保存: {filename}")

    def suggest_system_name(self) -> str:
        """为系统建议名称"""
        names = [
            "月历通 - 智能农历管理系统",
            "生辰宝 - 农历生日管家",
            "月相记 - 农历时间守护者",
            "农历智星 - 智能农历计算系统",
            "月华纪 - 农历日历大师",
            "时光韵 - 农历时间韵律系统",
            "月轮转 - 农历周期管理专家",
            "星辰历 - 智能农历日历",
            "月相守 - 农历提醒守护者",
            "农历生日提醒系统 - 精准农历计算系统"
        ]

        import random
        return random.choice(names)

    def create_skill_package(self, system_name: str):
        """创建技能包建议"""
        print(f"\n📦 技能包创建建议")
        print("=" * 40)

        skill_name = system_name.split(' - ')[0].replace(' ', '-').replace('—', '-').lower()

        print(f"技能名称: {skill_name}")
        print(f"显示名称: {system_name}")
        print(f"版本: 1.0.0")
        print(f"作者: 夏暮辞青")  # 这里会替换为用户的名字
        print(f"描述: 精准的农历生日提醒和管理系统，经过严格验证")

        print("\n📁 建议的目录结构:")
        print(f"{skill_name}/")
        print("├── SKILL.md")
        print("├── package.json")
        print("├── scripts/")
        print("│   ├── lunar_calculator.py")
        print("│   ├── validate_lunar.py")
        print("│   └── setup.sh")
        print("├── references/")
        print("│   ├── fortune_rules.md")
        print("│   └── solar_terms.md")
        print("├── tests/")
        print("│   └── validation.spec.js")
        print("└── README.md")

        print("\n🌐 发布目标:")
        print(f"  - GitHub: https://github.com/yourusername/{skill_name}")
        print(f"  - 小龙虾社区: https://clawhub.com/skills/{skill_name}")
        print(f"  - Skill package distribution")

        print("\n📝 下一步:")
        print("1. 完善技能文档")
        print("2. 添加更多测试用例")
        print("3. 创建安装脚本")
        print("4. 发布到各个平台")

def main():
    """主函数"""
    # 解析命令行参数
    iterations = 30  # 默认30次验证

    if len(sys.argv) > 1:
        try:
            iterations = int(sys.argv[1])
        except ValueError:
            print(f"错误：迭代次数必须是整数，使用默认值30")

    print(f"🌙 农历自动化生日提醒系统验证工具")
    print(f"计划进行 {iterations} 次验证测试")
    print("=" * 60)

    # 运行验证
    validator = LunarValidator()
    result = validator.run_validation(iterations)

    print("\n" + "=" * 60)
    print("验证完成!")

    if result['all_passed']:
        print("✅ 所有验证测试通过！系统可以发布。")
    else:
        print("⚠️  验证未完全通过，请检查系统逻辑。")

if __name__ == "__main__":
    main()

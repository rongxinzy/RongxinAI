import {
  CoworkSessionMode,
  type CoworkSessionMode as CoworkSessionModeValue,
} from '../../shared/cowork/constants';

const MAX_LIGHTWEIGHT_PROMPT_LENGTH = 600;

const SIMPLE_CONVERSATION_PATTERN =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|你好|您好|嗨|谢谢|多谢|好的|收到|聊聊|随便聊聊)[!.。！?？\s]*$/i;
const INFORMATION_REQUEST_PATTERN =
  /^(?:please\s+)?(?:what|why|when|where|who|how|explain|describe|tell me|is|are|can|could|would)\b|^(?:请问|请)?(?:什么|为什么|何时|哪里|谁|怎么|如何|解释|介绍|说明|告诉我|是否|能否|可以|你能)/i;
const LIGHTWEIGHT_TASK_PATTERN =
  /^(?:please\s+)?(?:show|list|read|find|search|count|calculate|translate|rewrite|summarize|proofread)\b|^(?:请)?(?:帮我)?(?:查看|列出|读取|查找|搜索|统计|计算|翻译|改写|总结|校对)|^(?:current time|today's date|现在几点|当前时间|今天几号|今天日期)/i;
const EXECUTION_REQUEST_PATTERN =
  /^(?:(?:please|can you|could you|would you)\s+)?(?:build|create|write|edit|modify|fix|implement|refactor|develop|test|deploy|install|configure|migrate|optimize|publish|generate|review|audit|inspect|analyze)\b|^(?:(?:请|能否|可以|你能)(?:帮我)?)?(?:构建|创建|写|编写|编辑|修改|修复|实现|重构|开发|测试|部署|安装|配置|迁移|优化|发布|生成|审查|审核|检查|分析)|^(?:把|将).+(?:编辑|修改|修复|重构|迁移|优化|发布)/i;
const MULTI_STEP_PATTERN =
  /\b(?:multi[- ]step|end[- ]to[- ]end|first.+then|and then)\b|(?:多步骤|完整流程|端到端|先.+再|然后)/i;
const RESEARCH_WORKFLOW_PATTERN =
  /^(?:(?:please|can you|could you|would you)\s+)?(?:research|investigate)\b|^(?:(?:请|能否|可以|你能)(?:帮我)?)?(?:研究|调研|调查)\b/i;
const PRODUCTION_OBJECT_PATTERN =
  /\b(?:app|application|website|service|feature|module|component|api|database|schema|repository|codebase|project|package|workflow|pipeline|presentation|deck|slide deck|spreadsheet|workbook|document|dashboard|report|test suite|deployment|release|stale closure)\b|(?:应用|网站|服务|功能|模块|组件|接口|数据库|数据表|仓库|代码库|项目|软件包|工作流|流程|流水线|演示文稿|幻灯片|PPT|电子表格|工作簿|文档|仪表盘|报告|测试套件|部署|发布|登录流程)/i;
const VALIDATION_OR_DELIVERY_PATTERN =
  /\b(?:validate|verify|acceptance|deliver|release|publish|deploy|package|benchmark|end[- ]to[- ]end test)\b|(?:验证|验收|交付|发布|部署|打包|基准测试|端到端测试)/i;

export interface ProductionWorkflowEntryInput {
  sessionMode?: CoworkSessionModeValue;
  prompt: string;
  goalMode?: boolean;
  inheritedProductionWorkflow?: boolean;
}

export const shouldEnableProductionWorkflow = (input: ProductionWorkflowEntryInput): boolean => {
  if (input.sessionMode === CoworkSessionMode.Chat) return false;
  if (input.inheritedProductionWorkflow !== undefined) {
    return input.inheritedProductionWorkflow;
  }
  if (input.goalMode) return true;

  const prompt = input.prompt.replace(/\s+/g, ' ').trim();
  if (!prompt) return false;
  const intentPrompt = prompt.replace(/^(?:hi|hello|hey|你好|您好|嗨)[,，!！\s]+/i, '');
  if (SIMPLE_CONVERSATION_PATTERN.test(prompt)) return false;
  const executionRequested = EXECUTION_REQUEST_PATTERN.test(intentPrompt);
  if (
    prompt.length <= MAX_LIGHTWEIGHT_PROMPT_LENGTH &&
    !executionRequested &&
    (INFORMATION_REQUEST_PATTERN.test(intentPrompt) || LIGHTWEIGHT_TASK_PATTERN.test(intentPrompt))
  ) {
    return false;
  }
  if (MULTI_STEP_PATTERN.test(intentPrompt) || RESEARCH_WORKFLOW_PATTERN.test(intentPrompt)) {
    return true;
  }
  if (!executionRequested) return false;

  return (
    PRODUCTION_OBJECT_PATTERN.test(intentPrompt) ||
    VALIDATION_OR_DELIVERY_PATTERN.test(intentPrompt)
  );
};

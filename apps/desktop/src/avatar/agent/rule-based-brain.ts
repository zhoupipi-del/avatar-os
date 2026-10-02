import type {
  AgentBrain,
  AgentBrainInput,
  AgentBrainOutput,
} from "./agent-intent";

export class RuleBasedBrain implements AgentBrain {
  async think(input: AgentBrainInput): Promise<AgentBrainOutput> {
    const text = input.text.trim();

    if (!text) {
      return {
        speech: "我在，等你说话。",
        intent: {
          type: "IDLE",
          intensity: 0.2,
        },
        emotion: {
          type: "neutral",
          intensity: 0.1,
        },
      };
    }

    if (containsAny(text, ["你好", "hello", "hi", "嗨", "早上好", "晚上好"])) {
      return {
        speech: "你好，我在这里。",
        intent: {
          type: "GREET",
          intensity: 0.75,
        },
        emotion: {
          type: "happy",
          intensity: 0.45,
        },
      };
    }

    if (containsAny(text, ["开心", "太好了", "棒", "成功", "通过了", "赢了"])) {
      return {
        speech: "这很好，我也替你高兴。",
        intent: {
          type: "BOUNCE_HAPPY",
          intensity: 0.65,
        },
        emotion: {
          type: "happy",
          intensity: 0.75,
        },
      };
    }

    if (containsAny(text, ["累", "难受", "烦", "崩", "失败", "压力", "焦虑"])) {
      return {
        speech: "我听到了。先别急，我们一步一步拆开处理。",
        intent: {
          type: "SAD_BODY",
          intensity: 0.55,
        },
        emotion: {
          type: "sad",
          intensity: 0.45,
        },
      };
    }

    if (containsAny(text, ["想一想", "分析", "怎么做", "方案", "计划", "架构", "代码"])) {
      return {
        speech: "我先分析一下。当前最重要的是收束范围，保留主线。",
        intent: {
          type: "THINKING",
          intensity: 0.65,
        },
        emotion: {
          type: "thinking",
          intensity: 0.7,
        },
      };
    }

    if (containsAny(text, ["看", "偷看", "peek", "过来"])) {
      return {
        speech: "我看到了。",
        intent: {
          type: "PEEK",
          intensity: 0.55,
        },
        emotion: {
          type: "curious",
          intensity: 0.5,
        },
      };
    }

    return {
      speech: `我明白了：${text}`,
      intent: {
        type: "THINKING",
        intensity: 0.35,
      },
      emotion: {
        type: "neutral",
        intensity: 0.2,
      },
    };
  }
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();

  return keywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
}

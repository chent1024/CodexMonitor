import { describe, expect, it } from "vitest";
import {
  deriveThreadDisplayTitle,
  getThreadDisplayTitle,
  getServerThreadTitle,
} from "./threadNaming";

describe("deriveThreadDisplayTitle", () => {
  it("removes polite leading words", () => {
    expect(deriveThreadDisplayTitle("帮我运行这个项目")).toBe("运行项目");
    expect(deriveThreadDisplayTitle("请分析剧集发布限额")).toBe("分析剧集发布限额");
  });

  it("turns url-only previews into page titles", () => {
    expect(deriveThreadDisplayTitle("https://chub.chubdm.com/overs...")).toBe(
      "查看 chub 页面",
    );
  });

  it("prefers surrounding text over raw urls", () => {
    expect(
      deriveThreadDisplayTitle("查看 https://chub.chubdm.com/overs 入库异常数据"),
    ).toBe("查看 入库异常数据");
  });

  it("turns command previews into task titles without executing commands", () => {
    expect(deriveThreadDisplayTitle("npm run tauri:dev")).toBe("运行 Tauri 开发服务");
    expect(deriveThreadDisplayTitle("$ npm run typecheck")).toBe("运行类型检查");
  });

  it("turns questions into analysis titles", () => {
    expect(
      deriveThreadDisplayTitle("为什么这个线程显示时间是now 里边的聊天内容不是最新的"),
    ).toBe("分析线程显示时间是now 里边的聊天内容不是最新的原因");
  });

  it("clips long titles", () => {
    expect(
      deriveThreadDisplayTitle("查看美臻入库异常可重试数据以及更多后续处理信息"),
    ).toBe("查看美臻入库异常可重试数据以及更多后续处理信息");
    expect(
      deriveThreadDisplayTitle("查看美臻入库异常可重试数据以及更多后续处理信息", 12),
    ).toBe("查看美臻入库异常可重试数…");
  });
});

describe("getServerThreadTitle", () => {
  it("prefers codex generated thread names", () => {
    expect(
      getThreadDisplayTitle(
        {
          threadName: "定位配音压字幕错误",
          preview: "https://chub.chubdm.com/overs...",
        },
        "https://chub.chubdm.com/overs...",
      ),
    ).toBe("定位配音压字幕错误");
  });

  it("supports alternate server title fields", () => {
    expect(getServerThreadTitle({ thread_name: "分析剧集发布限额" })).toBe(
      "分析剧集发布限额",
    );
    expect(getServerThreadTitle({ name: "允许管理员复审权限" })).toBe(
      "允许管理员复审权限",
    );
  });

  it("ignores generated ids and falls back to preview-derived titles", () => {
    expect(
      getThreadDisplayTitle(
        {
          name: "019c9e0e-7f97-78f2-a719-d28af9fb76b6",
          preview: "帮我运行这个项目",
        },
        "帮我运行这个项目",
      ),
    ).toBe("运行项目");
  });
});

import { Locale } from "@/lib/domain/types";

type Copy = {
  appName: string;
  appTagline: string;
  files: string;
  settings: string;
  explore: string;
  adminVideos: string;
  adminModeration: string;
  rightPanelFiles: string;
  attach: string;
  send: string;
  signIn: string;
  signOut: string;
  localeLabel: string;
  uploadHint: string;
  processing: string;
  ready: string;
  failed: string;
  expired: string;
};

const dictionary: Record<Locale, Copy> = {
  zh: {
    appName: "Magic Agent",
    appTagline: "魔术教学与演出陪练平台",
    files: "文件",
    settings: "设置",
    explore: "层级卡片",
    adminVideos: "视频库管理",
    adminModeration: "安全审计",
    rightPanelFiles: "文件洞察",
    attach: "附加",
    send: "发送",
    signIn: "登录",
    signOut: "退出登录",
    localeLabel: "语言",
    uploadHint: "上传 PDF、Word、文本或图片，解析完成后即可让 AI 阅读、讲解魔术和连续追问。",
    processing: "处理中",
    ready: "已完成",
    failed: "失败",
    expired: "已过期",
  },
  en: {
    appName: "Magic Agent",
    appTagline: "Magic coaching and performance copilot",
    files: "Files",
    settings: "Settings",
    explore: "Atlas",
    adminVideos: "Video Admin",
    adminModeration: "Moderation",
    rightPanelFiles: "File Insights",
    attach: "Attach",
    send: "Send",
    signIn: "Sign in",
    signOut: "Sign out",
    localeLabel: "Language",
    uploadHint: "Upload PDF, Word, text or images. Once parsed, ask AI to read, teach tricks and answer follow-up questions.",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    expired: "Expired",
  },
};

export function t(locale: Locale): Copy {
  return dictionary[locale] ?? dictionary.zh;
}

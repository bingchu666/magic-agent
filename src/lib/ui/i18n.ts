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
    uploadHint: "支持文档、图片、音频、视频。上传后自动解析。",
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
    uploadHint: "Upload docs, images, audio, and video. We process asynchronously.",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    expired: "Expired",
  },
};

export function t(locale: Locale): Copy {
  return dictionary[locale] ?? dictionary.zh;
}

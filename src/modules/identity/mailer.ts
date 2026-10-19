import nodemailer from "nodemailer";
import { env } from "../../common/config.js";
const transport = nodemailer.createTransport({
  host: env("SMTP_HOST"),
  port: Number(env("SMTP_PORT", "465")),
  secure: true,
  auth: { user: env("SMTP_USER"), pass: env("SMTP_PASSWORD") },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  tls: { rejectUnauthorized: true },
});
export async function sendMail(email: string, code: string) {
  const info = await transport.sendMail({
    from: {
      name: env("SMTP_FROM_NAME", "轻养健康"),
      address: env("SMTP_FROM_ADDRESS"),
    },
    to: email,
    subject: "轻养健康 · 登录验证码",
    text: `你的轻养健康验证码为：${code}\n5分钟内有效。未注册邮箱验证成功后将自动创建账号。\n如果不是你本人操作，请忽略本邮件。`,
  });
  if (!info.accepted?.length) throw new Error("SMTP did not accept recipient");
}

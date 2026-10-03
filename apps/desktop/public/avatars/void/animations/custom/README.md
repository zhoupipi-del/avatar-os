# 招牌动作放这里

1. 把导出的 `.vrma` 文件放进本目录（文件名只用英文、数字、`-`、`_`）。
2. 复制 `motions.example.json` 为 `motions.json`，每个动作一行：
   - `id`：大写英文，如 `HEART`（不能和内置动作 IDLE / GREET / THINKING 等重名）
   - `file`：本目录下的文件名
   - `label`：中文名
   - `when`：什么时候做——写给大模型看，它会在合适的时候用
   - `idleWeight`：闲着时自己做的权重，`0` = 只在聊天时用；数字越大越常做
3. 重启程序。开发模式下在小人窗口上右键 →「检查」（或 Ctrl+Shift+I）打开控制台，输入 `__avatarOSAgent.customMotions()` 看是否加载成功，
   `__avatarOSAgent.playMotion("HEART")` 立即播放。

某个文件坏了只会跳过它，不影响其他动作。最多 16 个。录制方法见落地手册「招牌动作」一节。

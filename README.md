# 小米视频纹理诊断页

版本：2026-09-18.3。打开 https://marroar.github.io/rvrland-video-texture-check/?v=20260918-3 ，确认标题 V3 后开始测试。保持前台，默认约 40–100 秒，完成后分段截图设备信息和 A–F 结果。建议同一台设备分别测试小米浏览器和 Chrome。不能复制时直接截图即可。

检测包括 A 静态四色图片、B 原始 MP4 地址、C fetch 后 Blob URL、D 分片 MP4 地址、E MSE 分片加载、F 暂停跳帧读取。B/C 使用相同文件，D/E 使用相同重新封装文件；分片文件通过 ffmpeg -i idle-high.mp4 -map 0:v:0 -c:v copy -an -movflags frag_keyframe+empty_moov+default_base_moof idle-fragmented.mp4 生成，不重新编码。D 用于区分封装变化与 E 的加载路径变化。F 仅用于检测暂停后能否读帧，不是动画修复方案。所有方式均为实验，不能保证绕过浏览器定制播放机制。

每组单独运行并释放视频、对象 URL 及 GPU 资源，约每 250ms 记录 Canvas、WebGL 和抠绿结果（F 额外等待 seeked）；累计 GL 错误与异常，记录帧提交回调、时间变化及后台状态。MSE 不支持、网络和事件超时明确记为未完成。原生播放是否可见仍需肉眼确认，时间变化不代表画面正常。MSE 接口参考：https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/addSourceBuffer 。

可选本机 NPC 视频，会增加两组测试，文件不会上传。默认仍为游客素材，不宣称覆盖全部 NPC，也不等同于完整 Three/Five 业务场景。

“有图像”仅表示像素统计不是全黑或全透明，不保证内容、颜色、方向正确。纯黑素材不适用此诊断。全透明与黑屏分别报告；抠绿可能合法产生透明。帧提交回调不能保证 Canvas/WebGL 可读取。不要仅凭一组结果认定硬件缺陷。

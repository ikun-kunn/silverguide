<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <h1 class="text-[1.5rem] font-bold">关于银龄引路人</h1>
    <section class="mt-4 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
      <h2 class="font-bold">帮助您一步一步学会用手机</h2>
      <p class="mt-2">银龄引路人是一款面向长辈、家属与社区志愿者的数字生活学习助手。无需注册即可练习模拟挂号和打车，不会产生真实订单或支付。</p>
    </section>
    <section class="mt-4 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
      <h2 class="font-bold">隐私与安全</h2>
      <p class="mt-2">学习记录只保存在当前浏览器中，可在设置中清除。只有主动确认后才发送截图到分析服务；请先遮挡个人敏感信息。AI 建议可能出错，不代替真实业务或专业建议。</p>
      <p class="mt-2">服务端不主动长期保存截图，但已发送的请求仍可能由 AI 服务提供方处理，请勿上传敏感资料。</p>
    </section>
    <section class="mt-4 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
      <h2 class="font-bold">技术说明</h2>
      <p class="mt-2">模拟训练由确定性任务状态机驱动；看图指导使用受保护的服务端 AI 接口，图片坐标经过校验后才显示标注。语音由浏览器提供，不支持时将保留文字。</p>
    </section>
    <RouterLink to="/" class="mt-5 block min-h-tap rounded-xl bg-sg-primary p-3 text-center font-bold text-sg-primary-ink">返回首页</RouterLink>
  </main>
</template>

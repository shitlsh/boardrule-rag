<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // App launched
})
</script>

<style lang="scss">
@import './uni.scss';

page {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    sans-serif;
  background-color: #f4f6f9;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

/* 移动端点击高亮减弱 */
view,
button,
text {
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.06);
}
</style>

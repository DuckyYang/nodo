<template>
  <el-form label-position="top" v-loading="loading">
    <el-form-item :label="t('config.wechat')">
      <el-tag :type="bound ? 'success' : 'info'">{{ bound ? t('config.wechatBound') : t('config.wechatUnbound') }}</el-tag>
      <p class="tip">{{ t('config.wechatTip') }}</p>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="binding" @click="onStartBind">{{ t('config.wechatStartBind') }}</el-button>
      <el-button v-if="bound" type="danger" plain :loading="unbinding" @click="onUnbind">{{ t('config.wechatUnbind') }}</el-button>
    </el-form-item>
    <el-dialog v-model="qrDialog" :title="t('config.wechatQrTitle')" width="360px" append-to-body @close="stopPolling">
      <div class="qr-box">
        <template v-if="qrUrl">
          <img :class="{ expired: bindStatus === 'expired' }" :src="qrUrl" alt="qr" />
          <p class="qr-status" :data-status="bindStatus">
            <template v-if="bindStatus === 'wait'">{{ t('config.wechatQrWait') }}</template>
            <template v-else-if="bindStatus === 'scaned'">{{ t('config.wechatQrScaned') }}</template>
            <template v-else-if="bindStatus === 'confirmed'">{{ t('config.wechatQrConfirmed') }}</template>
            <template v-else>{{ t('config.wechatQrExpired') }}</template>
          </p>
          <el-button v-if="bindStatus === 'expired'" link type="primary" @click="onStartBind">{{ t('config.wechatRefreshQr') }}</el-button>
        </template>
        <p v-else class="qr-status">{{ t('assistant.searching') }}</p>
      </div>
    </el-dialog>
  </el-form>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { configApi } from '../../../api/config'
import { useConfigStore } from '../../../stores/config'
import { apiError } from '../../../api/http'

const { t } = useI18n()
const cfgStore = useConfigStore()
const bound = ref(false)
const loading = ref(false)
const binding = ref(false)
const unbinding = ref(false)
const qrDialog = ref(false)
const qrUrl = ref('')
/** 当前扫码状态：wait / scaned / confirmed / expired */
const bindStatus = ref<'wait' | 'scaned' | 'confirmed' | 'expired'>('wait')
/** 轮询令牌：变化即终止旧轮询循环 */
let pollToken = 0
const emit = defineEmits<{ saved: [] }>()

onMounted(async () => {
  loading.value = true
  try {
    const cfg = await configApi.get()
    bound.value = !!cfg.wechatConfig?.bound
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(stopPolling)

function stopPolling() {
  pollToken++
}

/** 扫码绑定：取二维码 → 展示 → 长轮询状态直到 confirmed / expired */
async function onStartBind() {
  binding.value = true
  stopPolling()
  qrDialog.value = true
  qrUrl.value = ''
  bindStatus.value = 'wait'
  try {
    const qr = await configApi.wechatQrCode()
    qrUrl.value = qr.qrcodeUrl
    pollLoop(qr.qrcode)
  } catch (e) {
    ElMessage.error(apiError(e))
    qrDialog.value = false
  } finally {
    binding.value = false
  }
}

/** 长轮询循环：wait/scaned 继续轮询；confirmed 成功收尾；expired 停止并允许刷新 */
async function pollLoop(qrcode: string) {
  const myToken = ++pollToken
  while (qrDialog.value && myToken === pollToken) {
    try {
      const res = await configApi.wechatBindStatus(qrcode)
      if (myToken !== pollToken) return
      bindStatus.value = res.status
      if (res.status === 'confirmed') {
        bound.value = true
        await cfgStore.reload()
        emit('saved')
        setTimeout(() => { if (myToken === pollToken) qrDialog.value = false }, 1200)
        return
      }
      if (res.status === 'expired') return
    } catch (e) {
      if (myToken !== pollToken) return
      ElMessage.error(apiError(e))
      return
    }
  }
}

async function onUnbind() {
  try {
    await ElMessageBox.confirm(t('config.wechatUnbindConfirm'), t('config.wechatUnbind'), { type: 'warning' })
  } catch {
    return
  }
  unbinding.value = true
  try {
    await configApi.wechatUnbind()
    bound.value = false
    await cfgStore.reload()
    emit('saved')
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    unbinding.value = false
  }
}
</script>

<style scoped>
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 4px 0 0; }
.qr-box { text-align: center; padding: 16px; }
.qr-box img { max-width: 240px; }
.qr-box img.expired { opacity: 0.3; filter: grayscale(1); }
.qr-status { margin: 12px 0 0; font-size: 14px; color: var(--el-text-color-primary); }
.qr-status[data-status='scaned'] { color: var(--el-color-warning); }
.qr-status[data-status='confirmed'] { color: var(--el-color-success); }
.qr-status[data-status='expired'] { color: var(--el-color-danger); }
</style>

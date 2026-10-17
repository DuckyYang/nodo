<template>
  <el-form label-position="top">
    <el-form-item :label="t('config.avatar')">
      <div class="avatar-uploader">
        <el-avatar :size="96" :src="previewUrl || undefined">{{ (auth.user?.name || 'U').charAt(0).toUpperCase() }}</el-avatar>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onPick" ref="fileInput" style="display:none" />
        <el-button @click="fileInput?.click()">{{ t('actions.select') }}</el-button>
      </div>
      <p class="tip">{{ t('config.avatarTip') }}</p>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../../../stores/auth'
import { apiError } from '../../../api/http'

const { t } = useI18n()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement>()
const previewUrl = ref<string | null>(null)
const emit = defineEmits<{ saved: [] }>()

onMounted(async () => {
  if (auth.user?.id) {
    try {
      previewUrl.value = await window.nodo.resolveAvatarPath(auth.user.id)
    } catch {}
  }
})

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning(t('config.avatarTip'))
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = reader.result as string
    try {
      if (auth.user?.id) await window.nodo.saveAvatar(dataUrl, auth.user.id)
      previewUrl.value = dataUrl
      ElMessage.success(t('toast.saved'))
      emit('saved')
    } catch (e) {
      ElMessage.error(apiError(e))
    }
  }
  reader.readAsDataURL(file)
}
</script>

<style scoped>
.avatar-uploader { display: flex; align-items: center; gap: 16px; }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 8px 0 0; }
</style>

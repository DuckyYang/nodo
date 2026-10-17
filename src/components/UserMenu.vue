<template>
  <el-dropdown trigger="click" @command="onCommand">
    <div class="nodo-avatar">
      <el-avatar :size="32" :src="avatarUrl || undefined">
        {{ (user?.name || user?.email || 'U').charAt(0).toUpperCase() }}
      </el-avatar>
    </div>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="config">
          <el-icon><Setting /></el-icon>{{ t('actions.configCenter') }}
        </el-dropdown-item>
        <el-dropdown-item divided command="logout">
          <el-icon><SwitchButton /></el-icon>{{ t('actions.logout') }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Setting, SwitchButton } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const user = computed(() => auth.user)
const avatarUrl = ref<string | null>(null)

async function loadAvatar() {
  if (user.value?.id) {
    try {
      avatarUrl.value = await window.nodo.resolveAvatarPath(user.value.id)
    } catch {}
  }
}
onMounted(loadAvatar)

function onCommand(cmd: string) {
  if (cmd === 'config') router.push('/config')
  else if (cmd === 'logout') {
    auth.logout()
    ElMessage.success(t('toast.logout'))
    router.push('/login')
  }
}
</script>

<style scoped>
/* 顶栏按钮零间距排列时，头像 hover 圈与相邻按钮留 1px 呼吸缝 */
.nodo-avatar { cursor: pointer; padding: 2px; border-radius: 50%; }
.nodo-avatar:hover { background: var(--el-fill-color-light); }
</style>

<template>
  <div class="nodo-page config-page">
    <div class="config-tabs">
      <el-tabs v-model="activeTab" tab-position="left">
        <el-tab-pane :label="t('config.profile')" name="profile">
          <ProfileSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.password')" name="password">
          <PasswordSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.avatar')" name="avatar">
          <AvatarSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.model')" name="model">
          <ModelSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.bocha')" name="bocha">
          <BochaSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.postgres')" name="postgres">
          <PostgresSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.wechat')" name="wechat">
          <WeChatSection @saved="onSaved" />
        </el-tab-pane>
        <el-tab-pane :label="t('config.theme')" name="theme">
          <ThemeLangSection @saved="onSaved" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import ProfileSection from './sections/Profile.vue'
import PasswordSection from './sections/Password.vue'
import AvatarSection from './sections/Avatar.vue'
import ModelSection from './sections/Model.vue'
import BochaSection from './sections/Bocha.vue'
import PostgresSection from './sections/Postgres.vue'
import WeChatSection from './sections/WeChat.vue'
import ThemeLangSection from './sections/ThemeLang.vue'

defineOptions({ name: 'ConfigIndex' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const activeTab = ref<string>((route.params.section as string) || 'profile')

watch(activeTab, (v) => router.replace(`/config/${v}`))

function onSaved() {
  ElMessage.success(t('toast.saved'))
}
</script>

<style scoped>
.config-page { padding: 20px; overflow: auto; }
.config-tabs { min-height: 100%; }
.config-tabs :deep(.el-tabs__content) { overflow: visible; padding: 0 8px 24px; }
.config-tabs :deep(.el-tabs__item) { height: 44px; }
</style>

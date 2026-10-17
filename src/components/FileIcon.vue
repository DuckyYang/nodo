<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- 文件纸页（带折角） -->
    <path
      d="M6 3.5 h13.5 L26 10 v18.5 H6 Z" fill="var(--file-bg, #fff)" stroke="currentColor"
      class="file-body" stroke-width="1.6" stroke-linejoin="round"
    />
    <path d="M19.5 3.5 V10 H26" fill="none" stroke="currentColor" class="file-body" stroke-width="1.6" stroke-linejoin="round" />
    <!-- 后缀徽标 -->
    <rect class="badge-bg" x="4" y="17" width="21" height="10" rx="2.5" :fill="color" />
    <text x="14.5" y="24.6" text-anchor="middle" font-size="7.2" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">{{ label }}</text>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 22 })

// 按后缀映射（颜色 + 短标签）。命中 category 返回 [label, color]
const EXT_MAP: Record<string, [string, string]> = {
  // Office 文档
  doc: ['DOC', '#2b579a'], docx: ['DOC', '#2b579a'], rtf: ['DOC', '#2b579a'],
  xls: ['XLS', '#217346'], xlsx: ['XLS', '#217346'], csv: ['CSV', '#217346'],
  ppt: ['PPT', '#d24726'], pptx: ['PPT', '#d24726'],
  // PDF
  pdf: ['PDF', '#e04c41'],
  // 代码 / 标记
  md: ['MD', '#42a5f5'], markdown: ['MD', '#42a5f5'],
  java: ['JAVA', '#e76f00'], kt: ['KT', '#7f52ff'],
  js: ['JS', '#f7df1e'], mjs: ['JS', '#f7df1e'], ts: ['TS', '#3178c6'], tsx: ['TSX', '#3178c6'], jsx: ['JSX', '#61dafb'],
  py: ['PY', '#3776ab'], rb: ['RB', '#cc342d'], go: ['GO', '#00add8'], rs: ['RS', '#dea584'],
  c: ['C', '#555555'], h: ['H', '#555555'], cpp: ['C++', '#00599c'], cc: ['C++', '#00599c'], hpp: ['C++', '#00599c'],
  cs: ['C#', '#68217a'], swift: ['SW', '#f05138'], php: ['PHP', '#777bb4'],
  html: ['HTML', '#e34c26'], css: ['CSS', '#264de4'], scss: ['SCSS', '#cf649a'], less: ['LESS', '#2b5e91'],
  vue: ['VUE', '#42b883'], svelte: ['SV', '#ff3e00'],
  json: ['JSON', '#f5c518'], yml: ['YML', '#cb171e'], yaml: ['YML', '#cb171e'], toml: ['TOML', '#9c4221'],
  xml: ['XML', '#e37e3f'], sql: ['SQL', '#e38c00'],
  sh: ['SH', '#89e051'], bat: ['BAT', '#4d4d4d'], ps1: ['PS1', '#5391fe'],
  // 文本 / 其他
  txt: ['TXT', '#8a8a8a'], log: ['LOG', '#8a8a8a'],
  zip: ['ZIP', '#f0b429'], rar: ['RAR', '#f57c00'], '7z': ['7Z', '#b3684d'], tar: ['TAR', '#a0642b'], gz: ['GZ', '#a0642b'],
  png: ['PNG', '#a48ad4'], jpg: ['JPG', '#a48ad4'], jpeg: ['JPG', '#a48ad4'], gif: ['GIF', '#a48ad4'],
  svg: ['SVG', '#ffb13b'], webp: ['IMG', '#a48ad4'], ico: ['ICO', '#a48ad4'], bmp: ['BMP', '#a48ad4'],
  mp3: ['MP3', '#7b4dbf'], wav: ['WAV', '#7b4dbf'], flac: ['FLAC', '#7b4dbf'],
  mp4: ['MP4', '#e05a5a'], mov: ['MOV', '#e05a5a'], avi: ['AVI', '#e05a5a'], mkv: ['MKV', '#e05a5a'],
  exe: ['EXE', '#5c6bc0'], msi: ['MSI', '#5c6bc0'], dll: ['DLL', '#5c6bc0'],
  ipynb: ['IPYNB', '#f37726']
}

const ext = computed(() => {
  const m = props.name.match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
})

const label = computed(() => EXT_MAP[ext.value]?.[0] ?? 'FILE')
const color = computed(() => EXT_MAP[ext.value]?.[1] ?? '#909399')
</script>

<style scoped>
.file-body {
  color: #9aa4b2;
}
.dark .file-body { color: #6b7280; }
.badge-bg { opacity: 0.96; }
svg { flex-shrink: 0; }
:global(html.dark) .file-body { color: #6b7280; }
</style>

import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/auth/Login.vue'), meta: { guest: true } },
    { path: '/register', name: 'register', component: () => import('../views/auth/Register.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('../layouts/DefaultLayout.vue'),
      redirect: '/todo',
      children: [
        { path: 'todo', name: 'todo', component: () => import('../views/todo/Index.vue'), meta: { menu: 'todo' } },
        { path: 'notes', name: 'notes', component: () => import('../views/notes/Index.vue'), meta: { menu: 'notes' } },
        { path: 'assistant', name: 'assistant', component: () => import('../views/assistant/Index.vue'), meta: { menu: 'assistant' } },
        { path: 'config', name: 'config', component: () => import('../views/config/Index.vue') },
        { path: 'config/:section', name: 'config-section', component: () => import('../views/config/Index.vue') },
        { path: 'memories', name: 'memories', component: () => import('../views/memories/Index.vue') },
        { path: 'knowledge', name: 'knowledge', component: () => import('../views/knowledge/Index.vue') }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/todo' }
  ]
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!auth.token && !to.meta.guest) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (auth.token && to.meta.guest) return { name: 'todo' }
})

export default router

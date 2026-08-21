<script lang="ts" setup>
import { Badge } from '@/ui'
// The form thirty-three of forty-nine real components use: a named interface,
// not an inline type literal.
interface Props { title: string; count?: number; loading: boolean }
const props = withDefaults(defineProps<Props>(), { count: 0 })
</script>

<template>
  <div class="card">
    <Badge v-if="props.loading" />
    <router-view />
    <span>{{ props.title }}</span>
  </div>
</template>

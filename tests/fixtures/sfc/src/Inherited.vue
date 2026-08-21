<script lang="ts" setup>
import type { BaseProps } from './types'
// Declares nothing of its own — the props come from an imported type. Zero and
// unknown are different answers.
interface Props extends BaseProps {}
defineProps<Props>()
</script>

<template><div /></template>

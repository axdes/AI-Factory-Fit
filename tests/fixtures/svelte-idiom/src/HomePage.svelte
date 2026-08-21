<script lang="ts">
  import Widget from '../lib/Widget.svelte'
  import AppShell from '$lib/AppShell.svelte'

  export let name: string
  export let count = 0

  const handleGo = () => {}
</script>

<AppShell title="Home">
<div class="home" on:click={handleGo}>
  <Widget {name} />
  <p class="home__note">Archived memos</p>
  <p class="home__raw">{count}</p>
</div>
</AppShell>

<style>
  .home { gap: var(--space-2); }
  .home__note { color: var(--colour-faint); background: var(--colour-surface); }
  .home__raw { color: #999999; background: #ffffff; padding: 13px; }
</style>

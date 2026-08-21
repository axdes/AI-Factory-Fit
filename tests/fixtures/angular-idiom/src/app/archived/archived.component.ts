import { Component, input, signal, computed } from '@angular/core'

@Component({
  selector: 'app-archived',
  standalone: true,
  template: `
    <section class="archived">
      @if (empty()) {
        <p class="archived__note">Nothing archived</p>
      }
    </section>
  `,
  styles: [`
    .archived { gap: var(--space-2); }
    .archived__note { color: #999999; background: #ffffff; }
  `],
})
export class ArchivedComponent {
  readonly label = input<string>('')
  readonly rows = signal<string[]>([])
  readonly empty = computed(() => this.rows().length === 0)

  handleOpen(): void {}
}

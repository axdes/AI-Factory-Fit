import { Component } from '@angular/core'

@Component({
  selector: 'ds-table',
  standalone: true,
  template: '<div class="table"><ng-content /></div>',
})
export class UiTable {}

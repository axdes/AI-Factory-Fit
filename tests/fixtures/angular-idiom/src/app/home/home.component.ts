import { Component, Input } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Row } from '@app/shared/row'

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
  @Input() title = ''
  rows: Row[] = []

  handleGo(): void {}
}

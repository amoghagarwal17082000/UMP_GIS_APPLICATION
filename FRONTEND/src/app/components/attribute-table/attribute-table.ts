import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { AttributeTableService, LayerKey, Dataset, AttrRow } from '../../services/attribute-table';

@Component({
  selector: 'app-attribute-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attribute-table.html',
  styleUrls: ['./attribute-table.css'],
})
export class AttributeTableComponent {
  collapsedHeight = 40;
  expandedHeight = 380;

  open$!: Observable<boolean>;
  tabs$!: Observable<LayerKey[]>;
  active$!: Observable<LayerKey>;
  datasets$!: Observable<Record<LayerKey, Dataset>>;

  constructor(private attr: AttributeTableService) {
    this.open$ = this.attr.open$;
    this.tabs$ = this.attr.tabs$;
    this.active$ = this.attr.active$;
    this.datasets$ = this.attr.datasets$;
  }

  toggle() { this.attr.toggle(); }

  setTab(tab: LayerKey, ev?: MouseEvent) {
    ev?.stopPropagation();
    this.attr.setActive(tab);
  }

  onRowClick(active: LayerKey, row: AttrRow, ev?: MouseEvent) {
    ev?.stopPropagation();
    ev?.preventDefault();
    this.attr.selectRow(active, row);
  }

  onRowDoubleClick(active: LayerKey, row: AttrRow, ev?: MouseEvent) {
    ev?.stopPropagation();
    ev?.preventDefault();
    this.attr.selectRow(active, row);
  }

  zoomToSelected(active: LayerKey, ds: Dataset, ev?: MouseEvent) {
    ev?.stopPropagation();
    const selected = this.attr.getSelected();
    if (!selected || selected.layer !== active) return;
    const row = ds.rows.find((r) => Number((r as any).__rowid) === selected.rowId);
    if (row) this.attr.zoomToRow(active, row);
  }

  clearSelection(ev?: MouseEvent) {
    ev?.stopPropagation();
    this.attr.clearSelection();
  }

  exportCsv(active: LayerKey, ds: Dataset, ev?: MouseEvent) {
    ev?.stopPropagation();
    if (!ds.rows.length || !ds.columns.length) return;

    const escapeCell = (value: any) => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const csv = [
      ds.columns.join(','),
      ...ds.rows.map((row) => ds.columns.map((col) => escapeCell(row[col])).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${active.replace(/\s+/g, '_').toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  getDataset(d: Record<LayerKey, Dataset>, a: LayerKey): Dataset {
    return d[a] ?? { rows: [], columns: [], count: 0, features: [] };
  }

  isSelected(active: LayerKey, row: AttrRow): boolean {
    const selected = this.attr.getSelected();
    if (!selected) return false;
    return selected.layer === active && Number((row as any).__rowid) === selected.rowId;
  }

  hasSelectionFor(active: LayerKey): boolean {
    const selected = this.attr.getSelected();
    return !!selected && selected.layer === active;
  }
}

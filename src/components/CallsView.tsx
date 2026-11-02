'use client';

import * as React from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  SlidersHorizontal,
  Search,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { CallDetails, SummaryDetails } from './Drawer';
import { computeAverages } from '@/lib/useDashboardData';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { EmptyState } from './EmptyState';
import { TableRowSkeleton } from './Skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface CallsViewProps {
  calls: CallDetails[];
  summaries: Record<string, SummaryDetails>;
  initialLoading: boolean;
  onSelectCall: (call: CallDetails) => void;
  onSimulate: () => void;
  simulating: boolean;
  externalSearch?: string;
}

export function CallsView({
  calls,
  summaries,
  initialLoading,
  onSelectCall,
  onSimulate,
  simulating,
  externalSearch = '',
}: CallsViewProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'start_time', desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState(externalSearch);
  const [outcomeFilter, setOutcomeFilter] = React.useState('all');
  const [urgencyFilter, setUrgencyFilter] = React.useState('all');

  // Sync external search from TopBar if provided
  React.useEffect(() => {
    if (externalSearch !== undefined) {
      setGlobalFilter(externalSearch);
    }
  }, [externalSearch]);

  // Define table data with joined summaries
  const data = React.useMemo(() => {
    return calls.map((c) => ({
      ...c,
      summary: summaries[c.id] || null,
      avgLatency: computeAverages(c.latency)?.avgTotal ?? null,
    }));
  }, [calls, summaries]);

  // Define columns
  const columns = React.useMemo<ColumnDef<typeof data[0]>[]>(() => [
    {
      accessorKey: 'start_time',
      header: ({ column }) => {
        const isSorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-3 h-8 text-xs font-semibold hover:text-foreground"
          >
            <span>Time</span>
            {isSorted === 'asc' ? (
              <ArrowUp className="ml-1 h-3.5 w-3.5" />
            ) : isSorted === 'desc' ? (
              <ArrowDown className="ml-1 h-3.5 w-3.5" />
            ) : (
              <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/60" />
            )}
          </Button>
        );
      },
      cell: ({ row }) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          <RelativeTime date={row.original.start_time} />
        </span>
      ),
    },
    {
      accessorKey: 'customer_phone',
      header: ({ column }) => {
        const isSorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-3 h-8 text-xs font-semibold hover:text-foreground"
          >
            <span>Customer Phone</span>
            {isSorted === 'asc' ? (
              <ArrowUp className="ml-1 h-3.5 w-3.5" />
            ) : isSorted === 'desc' ? (
              <ArrowDown className="ml-1 h-3.5 w-3.5" />
            ) : (
              <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/60" />
            )}
          </Button>
        );
      },
      cell: ({ row }) => (
        <span className="font-medium text-foreground whitespace-nowrap">
          {row.original.customer_phone || 'unknown'}
        </span>
      ),
    },
    {
      accessorKey: 'end_reason',
      header: 'Outcome',
      cell: ({ row }) => {
        const reason = row.original.end_reason || 'in progress';
        return <StatusBadge status={reason} />;
      },
      filterFn: (row, id, value) => {
        if (!value || value === 'all') return true;
        const reason = (row.getValue(id) as string || 'in progress').toLowerCase();
        if (value === 'in_progress') return reason === 'in progress' || reason === 'in_progress';
        return reason.includes(value.toLowerCase());
      },
    },
    {
      id: 'urgency',
      accessorFn: (row) => row.summary?.status === 'unavailable' ? 'unavailable' : row.summary?.urgency || 'none',
      header: 'Urgency',
      cell: ({ row }) => {
        if (row.original.summary?.status === 'unavailable') {
          return <span className="text-muted-foreground text-xs italic">Unavailable</span>;
        }
        const urgency = row.original.summary?.urgency;
        if (!urgency) return <span className="text-muted-foreground">—</span>;
        return <StatusBadge status={urgency} />;
      },
      filterFn: (row, id, value) => {
        if (!value || value === 'all') return true;
        const urgency = (row.getValue(id) as string || '').toLowerCase();
        return urgency === value.toLowerCase();
      },
    },
    {
      id: 'reason',
      accessorFn: (row) => row.summary?.status === 'unavailable' ? 'Summary unavailable' : row.summary?.reason || row.summary?.short_summary || '',
      header: 'Reason',
      cell: ({ row }) => {
        if (row.original.summary?.status === 'unavailable') {
          return <span className="text-muted-foreground text-xs italic">Summary unavailable</span>;
        }
        const text =
          row.original.summary?.reason ||
          row.original.summary?.short_summary ||
          (row.original.end_reason ? 'No summary' : 'In progress...');
        return (
          <div className="max-w-xs truncate text-muted-foreground" title={text}>
            {text}
          </div>
        );
      },
    },
    {
      accessorKey: 'avgLatency',
      header: ({ column }) => {
        const isSorted = column.getIsSorted();
        return (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="-mr-3 h-8 text-xs font-semibold hover:text-foreground"
            >
              <span>Latency</span>
              {isSorted === 'asc' ? (
                <ArrowUp className="ml-1 h-3.5 w-3.5" />
              ) : isSorted === 'desc' ? (
                <ArrowDown className="ml-1 h-3.5 w-3.5" />
              ) : (
                <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/60" />
              )}
            </Button>
          </div>
        );
      },
      cell: ({ row }) => {
        const val = row.original.avgLatency;
        return (
          <div className="text-right font-mono tabular-nums text-foreground">
            {val !== null ? `${val} ms` : '—'}
          </div>
        );
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: () => (
        <div className="flex justify-end">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      ),
    },
  ], []);

  // Multi-field global filter
  const globalFilterFn = React.useCallback(
    (row: { original: CallDetails }, _columnId: string, filterValue: string) => {
      if (!filterValue) return true;
      const search = filterValue.toLowerCase().trim();
      const phone = (row.original.customer_phone || '').toLowerCase();
      const reason = (row.original.summary?.reason || '').toLowerCase();
      const summary = (row.original.summary?.short_summary || '').toLowerCase();
      const id = (row.original.id || '').toLowerCase();
      return (
        phone.includes(search) ||
        reason.includes(search) ||
        summary.includes(search) ||
        id.includes(search)
      );
    },
    []
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 15,
      },
    },
  });

  // Apply column filters when outcome/urgency state changes
  React.useEffect(() => {
    table.getColumn('end_reason')?.setFilterValue(outcomeFilter);
  }, [outcomeFilter, table]);

  React.useEffect(() => {
    table.getColumn('urgency')?.setFilterValue(urgencyFilter);
  }, [urgencyFilter, table]);

  const rowCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-4">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-card border border-border rounded-xl shadow-xs">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Filter calls..."
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>

          {/* Outcome Filter */}
          <div className="w-36">
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outcomes</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="opted_out">Opted Out</SelectItem>
                <SelectItem value="wrong_number">Wrong Number</SelectItem>
                <SelectItem value="user_ended">User Ended</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Urgency Filter */}
          <div className="w-32">
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Urgency</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Column Visibility Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize text-xs"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {column.id.replace('_', ' ')}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-xs text-muted-foreground whitespace-nowrap font-mono tabular-nums">
            {rowCount} {rowCount === 1 ? 'call' : 'calls'}
          </span>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        {initialLoading ? (
          <div className="p-4">
            <table className="w-full">
              <tbody>
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
              </tbody>
            </table>
          </div>
        ) : rowCount === 0 ? (
          <EmptyState
            title="No calls found"
            description={
              globalFilter || outcomeFilter !== 'all' || urgencyFilter !== 'all'
                ? 'Try adjusting your filters or search terms.'
                : 'No calls recorded yet. Trigger a simulated call to create your first session.'
            }
            actionText="Simulate missed call"
            onAction={onSimulate}
            loading={simulating}
          />
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onSelectCall(row.original)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCall(row.original);
                    }
                  }}
                  tabIndex={0}
                  className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/70 h-11"
                  role="button"
                  aria-label={`View call details for ${row.original.customer_phone}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* TanStack Pagination Controls */}
        {rowCount > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-card/50 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span>Page</span>
              <strong className="text-foreground font-mono">
                {table.getState().pagination.pageIndex + 1}
              </strong>
              <span>of</span>
              <strong className="text-foreground font-mono">
                {table.getPageCount() || 1}
              </strong>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                title="First page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-7 text-xs px-2.5"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-7 text-xs px-2.5"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                title="Last page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

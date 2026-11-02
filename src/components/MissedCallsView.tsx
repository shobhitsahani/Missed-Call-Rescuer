'use client';

import * as React from 'react';
import Link from 'next/link';
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
  ExternalLink,
  Search,
  SlidersHorizontal,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { MissedCall } from '@/lib/useDashboardData';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { TableRowSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface MissedCallsViewProps {
  missed: MissedCall[];
  initialLoading: boolean;
  onSimulate: () => void;
  simulating: boolean;
  externalSearch?: string;
}

export function MissedCallsView({
  missed,
  initialLoading,
  onSimulate,
  simulating,
  externalSearch = '',
}: MissedCallsViewProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'time', desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState(externalSearch);
  const [statusFilter, setStatusFilter] = React.useState('all');

  React.useEffect(() => {
    if (externalSearch !== undefined) {
      setGlobalFilter(externalSearch);
    }
  }, [externalSearch]);

  const columns = React.useMemo<ColumnDef<MissedCall>[]>(() => [
    {
      accessorKey: 'time',
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
          <RelativeTime date={row.original.time} />
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
          {row.original.customer_phone}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      filterFn: (row, id, value) => {
        if (!value || value === 'all') return true;
        const status = (row.getValue(id) as string || '').toLowerCase();
        return status.includes(value.toLowerCase());
      },
    },
    {
      id: 'actions',
      header: () => <span className="text-right block">Action</span>,
      cell: ({ row }) => {
        const isJoinable = row.original.status === 'new' || row.original.status === 'queued';
        return (
          <div className="flex justify-end">
            {isJoinable ? (
              <Link
                href={`/call/${row.original.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors"
              >
                <span>Open call page</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span className="text-muted-foreground text-xs">—</span>
            )}
          </div>
        );
      },
    },
  ], []);

  const globalFilterFn = React.useCallback(
    (row: { original: MissedCall }, _columnId: string, filterValue: string) => {
      if (!filterValue) return true;
      const search = filterValue.toLowerCase().trim();
      const phone = (row.original.customer_phone || '').toLowerCase();
      const id = (row.original.id || '').toLowerCase();
      return phone.includes(search) || id.includes(search);
    },
    []
  );

  const table = useReactTable({
    data: missed,
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

  React.useEffect(() => {
    table.getColumn('status')?.setFilterValue(statusFilter);
  }, [statusFilter, table]);

  const rowCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-4">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-card border border-border rounded-xl shadow-xs">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search by phone, ID..."
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>

          <div className="w-36">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="calling">Calling</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="opted_out">Opted Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
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
            {rowCount} {rowCount === 1 ? 'record' : 'records'}
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        {initialLoading ? (
          <div className="p-4">
            <table className="w-full">
              <tbody>
                <TableRowSkeleton columns={4} />
                <TableRowSkeleton columns={4} />
                <TableRowSkeleton columns={4} />
              </tbody>
            </table>
          </div>
        ) : rowCount === 0 ? (
          <EmptyState
            title="No missed calls found"
            description={
              globalFilter || statusFilter !== 'all'
                ? 'Try adjusting your filters or search terms.'
                : 'No missed calls recorded yet. Trigger a simulated call to start testing.'
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
                <TableRow key={row.id} className="h-11">
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

        {/* Pagination */}
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

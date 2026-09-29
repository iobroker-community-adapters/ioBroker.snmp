/**
 * snmp adapter - the MIB tree as a table
 *
 * Used by the MIB browser, where every row carries an add button, and by the setup wizard, where
 * every row carries a checkbox. Everything the two have in common - the indentation, the expand
 * toggle, the columns - lives here, the differing last column is passed in.
 *
 * The table has a fixed layout: the columns keep their share of the width, and a long value is cut
 * with an ellipsis instead of pushing the table beyond the dialog.
 */

import React from 'react';

import {
    Chip,
    CircularProgress,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
} from '@mui/material';
import { ChevronRight as ChevronRightIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';

import { I18n } from '@iobroker/gui-components';

import type { MibTreeNode } from './types';

/** share of the width per column - the last one only has to hold one button */
const COLUMNS = ['32%', '24%', '12%', '10%', '15%', '7%'];

const styles: Record<string, React.CSSProperties> = {
    /** every cell cuts its content instead of widening the table */
    cell: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    mono: {
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    /** the name, its expand button and the writeable marker in one line */
    nameCell: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
    },
    name: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    /** keeps the name of a leaf aligned with the name of a node which has an expand button */
    noToggle: {
        display: 'inline-block',
        flex: '0 0 auto',
        width: 24,
    },
    actionCell: {
        padding: 0,
        textAlign: 'center',
    },
};

interface MibTreeProps {
    /** the tree to display, already filtered */
    nodes: MibTreeNode[];
    /** oids of the expanded nodes */
    expanded: string[];
    /** called with the oid of the node whose expand button was clicked */
    onToggle: (oid: string) => void;
    /** the last column of a row - the add button of the browser, the checkbox of the wizard */
    renderAction: (node: MibTreeNode) => React.JSX.Element | null;
    /** shown instead of the rows as long as the tree is empty */
    emptyText: string;
    /** oids whose content is currently being read from the device */
    loading?: string[];
    /** height of the scrolling area */
    maxHeight?: number;
}

/**
 * MibTree - render a MIB tree as indented table rows
 *
 * @param props the tree, its expanded nodes and the renderer of the last column
 * @returns the table
 */
export default function MibTree(props: MibTreeProps): React.JSX.Element {
    /**
     * renderRows - the rows of one level and of all expanded children
     *
     * @param nodes nodes of the current level
     * @param depth nesting depth, used for the indentation
     * @returns the rows
     */
    const renderRows = (nodes: MibTreeNode[], depth: number): React.JSX.Element[] => {
        const rows: React.JSX.Element[] = [];

        for (const node of nodes) {
            // a folder of the live browser announces its children before they have been read
            const expandable = !!node.children?.length || !!node.hasChildren;
            const isExpanded = props.expanded.includes(node.oid);
            const isLoading = !!props.loading?.includes(node.oid);
            const label = node.instance ? `${node.name}.${node.instance}` : node.name;

            rows.push(
                <TableRow
                    key={node.oid}
                    hover
                >
                    <TableCell style={{ ...styles.cell, paddingLeft: 4 + depth * 16 }}>
                        <div style={styles.nameCell}>
                            {isLoading ? (
                                <CircularProgress
                                    size={14}
                                    style={{ margin: 5 }}
                                />
                            ) : expandable ? (
                                <IconButton
                                    size="small"
                                    onClick={() => props.onToggle(node.oid)}
                                    aria-label={isExpanded ? 'collapse' : 'expand'}
                                >
                                    {isExpanded ? (
                                        <ExpandMoreIcon fontSize="inherit" />
                                    ) : (
                                        <ChevronRightIcon fontSize="inherit" />
                                    )}
                                </IconButton>
                            ) : (
                                <span style={styles.noToggle} />
                            )}

                            <Tooltip title={node.description || label}>
                                <span style={{ ...styles.name, fontWeight: node.readable ? 500 : 400 }}>{label}</span>
                            </Tooltip>

                            {node.writeable ? (
                                <Chip
                                    size="small"
                                    label={I18n.t('snmp_mib_writeable')}
                                />
                            ) : null}
                        </div>
                    </TableCell>

                    <Tooltip title={node.oid}>
                        <TableCell style={styles.mono}>{node.oid}</TableCell>
                    </Tooltip>

                    <TableCell style={styles.cell}>{node.syntax || ''}</TableCell>
                    <TableCell style={styles.cell}>{node.access || ''}</TableCell>

                    <Tooltip title={node.value || ''}>
                        <TableCell style={styles.mono}>{node.value ?? ''}</TableCell>
                    </Tooltip>

                    <TableCell style={styles.actionCell}>{props.renderAction(node)}</TableCell>
                </TableRow>,
            );

            if (expandable && isExpanded && node.children?.length) {
                rows.push(...renderRows(node.children, depth + 1));
            }
        }

        return rows;
    };

    return (
        <Paper
            variant="outlined"
            style={{ maxHeight: props.maxHeight ?? 420, overflowY: 'auto', overflowX: 'hidden' }}
        >
            <Table
                size="small"
                stickyHeader
                style={{ tableLayout: 'fixed', width: '100%' }}
            >
                <colgroup>
                    {COLUMNS.map(width => (
                        <col
                            key={width}
                            style={{ width }}
                        />
                    ))}
                </colgroup>
                <TableHead>
                    <TableRow>
                        <TableCell style={styles.cell}>{I18n.t('snmp_mib_colName')}</TableCell>
                        <TableCell style={styles.cell}>{I18n.t('snmp_mib_colOid')}</TableCell>
                        <TableCell style={styles.cell}>{I18n.t('snmp_mib_colSyntax')}</TableCell>
                        <TableCell style={styles.cell}>{I18n.t('snmp_mib_colAccess')}</TableCell>
                        <TableCell style={styles.cell}>{I18n.t('snmp_mib_colValue')}</TableCell>
                        <TableCell style={styles.actionCell}>{I18n.t('snmp_mib_colAdd')}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {props.nodes.length ? (
                        renderRows(props.nodes, 0)
                    ) : (
                        <TableRow>
                            <TableCell colSpan={COLUMNS.length}>{props.emptyText}</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </Paper>
    );
}

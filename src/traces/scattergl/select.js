/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var subtypes = require('../scatter/subtypes');

module.exports = function selectPoints(searchInfo, polygon) {
    var cd = searchInfo.cd,
        xa = searchInfo.xaxis,
        ya = searchInfo.yaxis,
        selection = [],
        trace = cd[0].trace,
        curveNumber = trace.index,
        i,
        di,
        x,
        y;

    var scattergl = cd[0].glTrace;
    var scene = cd[0].glTrace.scene;

    // TODO: include lines? that would require per-segment line properties
    var hasOnlyLines = (!subtypes.hasMarkers(trace) && !subtypes.hasText(trace));
    if(trace.visible !== true || hasOnlyLines) return;

    // filter out points by visible scatter ones
    // var scatter2d = scattergl.scatter.instance

    if(polygon === false) { // clear selection
        for(i = 0; i < cd.length; i++) cd[i].dim = 0;
    }
    else {
        for(i = 0; i < cd.length; i++) {
            di = cd[i];
            //FIXME: this affects performance for 1e6 points
            x = xa.c2p(di.x);
            y = ya.c2p(di.y);
            if(polygon.contains([x, y])) {
                selection.push({
                    // curveNumber: curveNumber,
                    // pointNumber: i,
                    x: di.x,
                    y: di.y,
                    // FIXME: di.id is undefined for scattergls
                    // id: di.id
                });
                di.dim = 0;
            }
            else di.dim = 1;
        }
    }

    // highlight selected points here
    trace.selection = selection;

    // scene.plot([fullTrace], [cd], scene.fullLayout);

    // excerpt from ↑
    scattergl.update(trace, cd);
    scene.glplot.setDirty();

    return selection;
};
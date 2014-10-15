'use strict';

var createSurface = require('gl-surface-plot'),
    camera = require('./scene-camera'),
    ndarray = require('ndarray'),
    ops = require('ndarray-ops'),
    fill = require('ndarray-fill'),
    glm = require('gl-matrix'),
    createAxes = require('gl-axes'),
    getAxesPixelRange = require('gl-axes/properties'),
    createScatterLine = require('./line-with-markers'),
    calculateError = require('./calc-errors'),
    arrtools = require('arraytools'),
    createSelect = require('gl-select'),
    createSpikes = require('gl-spikes'),
    pixelLength = require('./compute-tick-length'),
    project = require('./project'),
    tinycolor = require('tinycolor2'),
    arrayCopy1D = arrtools.copy1D,
    arrayCopy2D = arrtools.copy2D,
    mat4 = glm.mat4,
    proto;

var OBJECTS_PER_SCATTER3D = 4;


function str2RgbaArray(color) {
    color = tinycolor(color);
    return arrtools.str2RgbaArray(color.toRgbString());
}

function badSurfaceData (data) {
    return !data || !data.z || !data.z.length || !data.z[0].length;
}

function ticksChanged (ticksA, ticksB) {
    var nticks;
    for (var i = 0; i < 3; ++i) {
        if (ticksA[i].length !== ticksB[i].length) return true;
        nticks = Math.min(ticksA[i].length, ticksB[i].length);
        if (nticks === 0) continue;
        for (var j = 0; j < nticks; j++) {
            if (ticksA[i][j].x !== ticksB[i][j].x ||
                ticksA[i][j].text !== ticksB[i][j].text) {
                return true;
            }
        }
    }

    return false;
}


// PASS IN GLOBAL LAYOUT, LET THIS THING CARVE OUT SCENELAYOUT
function Scene (options, shell) {

    if (!(this instanceof Scene)) return new Scene(shell);

    this.shell                   =  shell;
    this.camera                  = camera(shell);
    this.container               = null;
    this.renderQueue             = [];
    this.axis                    = null;
    this.id                      = options.id;
    this.Plotly                  = options.Plotly;
    this.layout                  = options.layout;
    this.sceneLayout             = options.layout[this.id];

    this.markerSymbols           = null;
    this.selectBuffer            = null;
    this.pickRadius              = 30; //Number of pixels to search for closest point
    this.objectCount             = 0;


    this.glDataMap               = {};
    this.baseRange               = [ [ Infinity,  Infinity,  Infinity],  // min (init opposite)
                                     [-Infinity, -Infinity, -Infinity] ];  // max (init opposite)

    this.range                   = [ [ 0, 0, 0],    // min (init opposite)
                                     [ 6, 6, 6] ];  // max (init opposite)

    ////////////// AXES OPTIONS DEFAULTS ////////////////
    this.axesOpts = {};

    this.axesOpts.bounds         = [ [-10, -10, -10],
                                     [ 10,  10,  10] ];

    this.axesOpts.ticks          = [ [], [], [] ];
    this.axesOpts.tickEnable     = [ true, true, true ];
    this.axesOpts.tickFont       = [ 'sans-serif', 'sans-serif', 'sans-serif' ];
    this.axesOpts.tickSize       = [ 12, 12, 12 ];
    this.axesOpts.tickAngle      = [ 0, 0, 0 ];
    this.axesOpts.tickColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];
    this.axesOpts.tickPad        = [ 18, 18, 18 ];

    this.axesOpts.labels         = [ 'x', 'y', 'z' ];
    this.axesOpts.labelEnable    = [ true, true, true ];
    this.axesOpts.labelFont      = ['Open Sans','Open Sans','Open Sans'];
    this.axesOpts.labelSize      = [ 20, 20, 20 ];
    this.axesOpts.labelAngle     = [ 0, 0, 0 ];
    this.axesOpts.labelColor     = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];
    this.axesOpts.labelPad       = [ 30, 30, 30 ];

    this.axesOpts.lineEnable     = [ true, true, true ];
    this.axesOpts.lineMirror     = [ false, false, false ];
    this.axesOpts.lineWidth      = [ 1, 1, 1 ];
    this.axesOpts.lineColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];

    this.axesOpts.lineTickEnable = [ true, true, true ];
    this.axesOpts.lineTickMirror = [ false, false, false ];
    this.axesOpts.lineTickLength = [ 10, 10, 10 ];
    this.axesOpts.lineTickWidth  = [ 1, 1, 1 ];
    this.axesOpts.lineTickColor  = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];

    this.axesOpts.gridEnable     = [ true, true, true ];
    this.axesOpts.gridWidth      = [ 1, 1, 1 ];
    this.axesOpts.gridColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];

    this.axesOpts.zeroEnable     = [ true, true, true ];
    this.axesOpts.zeroLineColor  = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ];
    this.axesOpts.zeroLineWidth  = [ 2, 2, 2 ];

    this.axesOpts.backgroundEnable = [ false, false, false ];
    this.axesOpts.backgroundColor  = [ [0.8, 0.8, 0.8, 0.5],
                                       [0.8, 0.8, 0.8, 0.5],
                                       [0.8, 0.8, 0.8, 0.5] ];

    // some default values are stored for applying model transforms
    this.axesOpts._defaultTickPad         = arrayCopy1D(this.axesOpts.tickPad);
    this.axesOpts._defaultLabelPad        = arrayCopy1D(this.axesOpts.labelPad);
    this.axesOpts._defaultLineTickLength  = arrayCopy1D(this.axesOpts.lineTickLength);


    ///////////////////////////////////////////


    this.axisSpikes      = null;
    this.spikeEnable     = true;
    this.spikeProperties = {
        enable:         [true, true, true],
        colors:         [[0,0,0,1],
                         [0,0,0,1],
                         [0,0,0,1]],
        sides:          [true, true, true],
        width:          [1,1,1]
    };

    this.axesNames = ['xaxis', 'yaxis', 'zaxis'];

    this.model = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);

    this.defaultView = [
        1.25, 1.25, 1.25,
        0,    0,    0,
        0,    0,    1
    ];


    // preconfigure view
    this.camera.lookAt(
        this.defaultView.slice(0,3),
        this.defaultView.slice(3,6),
        this.defaultView.slice(6,9)
    );

    //Currently selected data point
    this.selection = null;


    /*
     * gl-render is triggered in the animation loop, we hook in
     * glcontext object into the loop here
     */
    shell.on('gl-render', this.onRender.bind(this));
}


module.exports = Scene;

proto = Scene.prototype;


proto.handlePick = function(cameraParameters) {
    var i, pass, glObject,
        pickResult=null,
        pickData=null,
        curResult=null,
        curData=null;

    if(!this.selectBuffer) {
        return null;
    }

    this.selectBuffer.shape = [this.shell.height,this.shell.width];

    //Do one pass for each group of objects, find the closest point in z
    for(pass=0; (pass<<8)<this.objectCount; ++pass) {

        //First render all objects in this group to the select buffer
        this.selectBuffer.begin(this.shell.mouseX, this.shell.mouseY, this.pickRadius);
        for (i = 0; i < this.renderQueue.length; ++i) {
            glObject = this.renderQueue[i];
            if(glObject.groupId === pass) {
                glObject.drawPick(cameraParameters);
            }
        }
        curResult = this.selectBuffer.end();

        //Skip this pass if the result was not valid
        if(!curResult || (pickResult && curResult.distance > pickResult.distance)) {
            continue;
        }

        //Scan through objects and find the selected point
        for(i = 0; i < this.renderQueue.length; ++i) {
            glObject = this.renderQueue[i];
            if(glObject.groupId !== pass) {
                continue;
            }
            curData = glObject.pick(curResult);
            if(curData) {
                curData.glObject  = glObject;

                var p = project(cameraParameters, curData.position);
                curData.zDistance = p[2]/p[3];

                //Only update selected value if it is closer than all other objects
                if(!pickData || pickData.zDistance > curData.zDistance) {
                    pickResult        = curResult;
                    pickData          = curData;
                }
            }
        }
    }

    //Compute data coordinate and screen location for pick result
    if(pickData) {
        glObject = pickData.glObject;

        //Compute data coordinate for point
        switch(glObject.plotlyType) {
            case 'scatter3d':
                pickData.dataCoordinate = glObject.dataPoints[pickData.index];
            break;

            case 'surface':
                pickData.dataCoordinate = [
                    glObject._ticks[0].get(pickData.index[0]),
                    glObject._ticks[1].get(pickData.index[1]),
                    glObject._field.get(pickData.index[0], pickData.index[1]) ];
            break;
        }

        //Compute screen coordinate
        var p = project(cameraParameters, pickData.dataCoordinate);
        pickData.screenCoordinate = [
            0.5 * this.shell.width  * (1.0+p[0]/p[3]),
            0.5 * this.shell.height * (1.0-p[1]/p[3]) ];

        //Send mouse coordinate
        pickData.mouseCoordinate = pickResult.coord;
    }

    return pickData;
};

proto.onRender = function () {
    /*
     * On each render animation cycle reset camera parameters
     * in case view has changed.
     * This can probably be optimized
     */

    var cameraParameters = {
        view: this.camera.view(),
        projection: mat4.perspective(
            new Array(16),
            Math.PI/4.0,
            this.shell.width/this.shell.height,
            0.1, 10000.0
        ),
        model: this.model
    };

    var i, glObject, ticks = [],
        gl = this.shell.gl,
        sceneLayout = this.sceneLayout,
        nticks, autoTickCached,
        glRange, axes,
        width = this.shell.width,
        height = this.shell.height,
        pickResult;

    var centerPoint = [0,0,0];
    function solveLength(a, b) {
        for(var i=0; i<3; ++i) {
            a[i] = pixelLength(cameraParameters,
                        [width, height],
                        centerPoint,
                        i,
                        b[i]) / cameraParameters.model[5*i];
        }
    }

    // turns on depth rendering order.
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // do point picking
    this.selection = pickResult = this.handlePick(cameraParameters);

    if (this.axis) {

        glRange = getAxesPixelRange(this.axis,
                                    cameraParameters,
                                    width,
                                    height);


        for (i = 0; i < 3; ++i) {
            axes = sceneLayout[this.axesNames[i]];

            axes._length = (glRange[i].hi - glRange[i].lo) *
                glRange[i].pixelsPerDataUnit;

            if (Math.abs(axes._length) === Infinity) {
                ticks[i] = [];
            }

            else {
                axes.range[0] = glRange[i].lo;
                axes.range[1] = glRange[i].hi;
                axes._m = 1 / glRange[i].pixelsPerDataUnit;
                // this is necessary to short-circuit the 'y' handling
                // in autotick part of calcTicks... Treating all axes as 'y' in this case
                // running the autoticks here, then setting
                // autoticks to false to get around the 2D handling in calcTicks.
                autoTickCached = axes.autotick;
                if (axes.autotick) {
                    axes.autotick = false;
                    nticks = axes.nticks || this.Plotly.Lib.constrain((axes._length/40), 4, 9);
                    this.Plotly.Axes.autoTicks(axes, Math.abs(axes.range[1]-axes.range[0])/nticks);
                }
                ticks[i] = this.Plotly.Axes.calcTicks(axes);

                axes.autotick = autoTickCached;
            }
        }

        if (ticksChanged(this.axesOpts.ticks, ticks)) {
            this.axesOpts.ticks = ticks;

            this.axis.update(this.axesOpts);
        }


        //Calculate tick lengths dynamically
        for(i=0; i<3; ++i) {
            centerPoint[i] = 0.5 * (this.axis.bounds[0][i] + this.axis.bounds[1][i]);
        }

        solveLength(this.axis.lineTickLength, this.axesOpts._defaultLineTickLength);
        solveLength(this.axis.tickPad, this.axesOpts._defaultTickPad);
        solveLength(this.axis.labelPad, this.axesOpts._defaultLabelPad);

        this.axis.draw(cameraParameters);
    }
    /*
     * Draw all objects in the render queue without transparency
     */
    for (i = 0; i < this.renderQueue.length; ++i) {
        glObject = this.renderQueue[i];
        glObject.draw(cameraParameters, false);
    }

    /*
     * Draw all objects in the render queue with transparency
     */
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    /*
     * Draw axes spikes for picking
     */
    if(pickResult && this.axisSpikes && this.spikeEnable) {
        this.axisSpikes.update({
            position:       pickResult.dataCoordinate,
            bounds:         this.axis.bounds,
            colors:         this.spikeProperties.colors,
            drawSides:      this.spikeProperties.sides,
            enabled:        this.spikeProperties.enable,
            lineWidth:      this.spikeProperties.width
        });
        this.axisSpikes.draw(cameraParameters);
    }

    for (i = 0; i < this.renderQueue.length; ++i) {
        glObject = this.renderQueue[i];
        if(glObject.supportsTransparency) {
            glObject.draw(cameraParameters, true);
        }
    }
    gl.disable(gl.BLEND);
};


/**
 *
 *
 */
proto.draw = function (layout, data) {

    var glObject;

    // sets the modules layout with incoming layout.
    // also set global layout properties.
    // Relinking this on every draw is necessary as
    // the existing layout *may* be overwritten by a new
    // incoming layout.
    this.setAndSyncLayout(layout);

    // add or update gl-data.
    this.setData(data);

    glObject = this.glDataMap[data.uid];

    // add to queue if visible, remove if not visible.
    this.updateRenderQueue(data, glObject);

    // set manual range by clipping globjects, or calculate new auto-range
    this.setAxesRange();

    // uses internal range to set this.model to autoscale data
    this.setModelScale();

    // configues axes: grabs necessary stuff out of the layouts and applies it.
    this.configureAxes();

    if(!this.selectBuffer) {
        this.selectBuffer = createSelect(this.shell.gl, [this.shell.height,this.shell.width]);
    }

    if(!this.axisSpikes) {
        this.axisSpikes = createSpikes(this.shell.gl);
    }

    return;
};



proto.Surface = function Surface (data) {
    /*
     * Create a new surfac
     */


    if (badSurfaceData(data)) return null;

    var surface,
        idx, i , j,
        colormap = data.colorscale || 'jet',
        zdata = data.z,
        x = data.x,
        y = data.y,
        xaxis = this.sceneLayout.xaxis,
        yaxis = this.sceneLayout.yaxis,
        zaxis = this.sceneLayout.zaxis,
        ticks = [[],[]],
        Nx = zdata[0].length,
        Ny = zdata.length,
        field = ndarray(new Float32Array(Nx*Ny), [Nx, Ny]),
        gl = this.shell.gl;

    /*
     * Fill and transpose zdata.
     * Consistent with 'heatmap' and 'contour', plotly 'surface'
     * 'z' are such that sub-arrays correspond to y-coords
     * and that the sub-array entries correspond to a x-coords,
     * which is the transpose of 'gl-surface-plot'.
     */
    fill(field, function(row, col) {
        return Number(zdata[col][row]);
    });

    // Map zdata if log axis
    if (zaxis.type === 'log') {
        ops.divseq(ops.logeq(field), Math.LN10);
    }

    if (Array.isArray(x) && x.length) {
       // if x is set, use it to defined the ticks
        for (i=0; i<Nx; i++) {
            ticks[0][i] = xaxis.d2c(x[i]);
        }
    } else {
       // if not, make linear space
        for (i=0; i<Nx; i++) {
            if (xaxis.type === 'log') ticks[0][i] = xaxis.c2l(i);
            else ticks[0][i] = i;
        }
    }

    if (Array.isArray(y) && y.length) {
       // if y is set, use it to defined the ticks
        for (j=0; j<Ny; j++) {
            ticks[1][j] = yaxis.d2c(y[j]);
        }
    } else {
       // if not, make linear space
        for (j=0; j<Ny; j++) {
            if (yaxis.type === 'log') ticks[1][j] = yaxis.c2l(j);
            else ticks[1][j] = j;
        }
    }


    var params = {
        field: field,
        ticks: ticks,
        colormap: colormap
    };


    /*
     * Make this more efficient by storing glObjects in
     * a hash with uids as key. Perhaps also store them
     * in an array.
     */
    idx = this.renderQueue.map(function (g) {
        return g.uid;
    }).indexOf(data.uid);

    if (idx > -1) {
        /*
         * We already have drawn this surface,
         * lets just update it with the latest params
         */
        surface = this.renderQueue[idx];
        surface.update(params);
    } else {
        /*
         * Push it onto the render queue
         */
        params.pickId       = (this.objectCount++) % 256;
        surface             =  createSurface(gl, field, params);
        surface.groupId     = (this.objectCount-1) >>> 8;
        surface.plotlyType  = data.type;
    }

    return surface;
};



function calculateErrorCapSize(errors) {
    /*jshint camelcase: false */
    var result = [0.0,0.0,0.0], i, e;
    for(i=0; i<3; ++i) {
        e = errors[i];
        if (e && e.copy_zstyle !== false) {
            e = errors[2];
        }
        if(!e) {
            continue;
        }
        if(e && 'width' in e) {
            result[i] = e.width / 100.0;  //Ballpark rescaling, attempt to make consistent with plot.ly
        }
    }
    return result;
}


function calculateTextOffset(textposition) {
    //Read out text properties
    var textOffset = [0,0];
    if (textposition.indexOf('bottom') >= 0) {
        textOffset[1] += 1;
    }
    if (textposition.indexOf('top') >= 0) {
        textOffset[1] -= 1;
    }
    if (textposition.indexOf('left') >= 0) {
        textOffset[0] -= 1;
    }
    if (textposition.indexOf('right') >= 0) {
        textOffset[0] += 1;
    }
    return textOffset;
}


proto.Scatter = function Scatter (data) {
    /*jshint camelcase: false */
    /*
     * data object {x,y,z and  marker: {size:size, color:color}}
     */

    // if (!('marker' in data)) data.marker = {};

    var params, scatter, idx, i,
        points = [],
        xaxis = this.sceneLayout.xaxis,
        yaxis = this.sceneLayout.yaxis,
        zaxis = this.sceneLayout.zaxis,
        errorProperties = [ data.error_x, data.error_y, data.error_z ],
        xc, x = data.x,
        yc, y = data.y,
        zc, z = data.z,
        len = x.length;


    //Convert points
    idx = 0;
    for (i = 0; i < len; i++) {
        // sanitize numbers
        xc = xaxis.d2c(x[i]);
        yc = yaxis.d2c(y[i]);
        zc = zaxis.d2c(z[i]);

        // apply any axis transforms
        if (xaxis.type === 'log') xc = xaxis.c2l(xc);
        if (yaxis.type === 'log') yc = yaxis.c2l(yc);
        if (zaxis.type === 'log') zc = zaxis.c2l(zc);

        points[idx] = [xc, yc, zc];
        ++idx;
    }
    if (!points.length) {
        return void 0;
    }

    //Build object parameters
    params = {
        position: points,
        mode:     data.mode
    };

    if ('line' in data) {
        params.lineColor  = str2RgbaArray(data.line.color);
        params.lineWidth  = data.line.width;
        params.lineDashes = data.line.dash;
    }

    if ('marker' in data) {
        params.scatterColor     = str2RgbaArray(data.marker.color);
        params.scatterSize      = 2*data.marker.size;  // rough parity with Plotly 2D markers
        params.scatterMarker    = this.markerSymbols[data.marker.symbol];
        params.scatterLineWidth = data.marker.line.width;
        params.scatterLineColor = str2RgbaArray(data.marker.line.color);
        params.scatterAngle     = 0;
    }

    if ('error_z' in data) {
        params.errorBounds    = calculateError(data),
        params.errorColor     = errorProperties.map( function (e) {return str2RgbaArray(e.color); });
        params.errorLineWidth = errorProperties.map( function (e) {return e.thickness; });
        params.errorCapSize   = calculateErrorCapSize(errorProperties);
    }

    if ('textposition' in data) {
        params.text           = data.text;
        params.textOffset     = calculateTextOffset(data.position);
        params.textColor      = str2RgbaArray(data.textfont.color);
        params.textSize       = data.textfont.size;
        params.textFont       = data.textfont.family;
        params.textAngle      = 0;
    }
    params.delaunayAxis       = data.delaunayaxis;
    params.delaunayColor      = str2RgbaArray(data.delaunaycolor);



    idx = this.renderQueue.map(function (g) {
        return g.uid;
    }).indexOf(data.uid);

    if (idx > -1) {
        /*
         * We already have drawn this surface,
         * lets just update it with the latest params
         */
        scatter = this.renderQueue[idx];
        scatter.update(params);
    } else {
        /*
         * Push it onto the render queue
         */
        params.pickId0   = (this.objectCount++)%256;
        params.pickId1   = (this.objectCount++)%256;
        params.pickId2   = (this.objectCount++)%256;
        params.pickId3   = (this.objectCount++)%256;
        scatter          = createScatterLine(this.shell.gl, params);
        scatter.groupId  = (this.objectCount-1)>>8;
        scatter.plotlyType  = data.type;
    }


    return scatter;
};


proto.setAndSyncLayout = function setAndSyncLayout (layout) {
    var cameraPosition,
        sceneLayout;

    this.layout = layout;
    this.sceneLayout = sceneLayout = this.layout[this.id];
    cameraPosition = sceneLayout.cameraposition;

    if (sceneLayout.bgcolor) {
        this.container.style.background = sceneLayout.bgcolor;
    }

    // set webgl state from layout

    if (Array.isArray(cameraPosition) && cameraPosition.length === 3) {
        this.camera.rotation = cameraPosition[0];
        this.camera.center = cameraPosition[1];
        this.camera.distance = cameraPosition[2];
    }

    // set Layout state from webgl
    this.saveStateToLayout();
};




proto.saveStateToLayout = function () {

    var sceneLayout = this.layout[this.id];
    sceneLayout.cameraposition = [
        this.camera.rotation,
        this.camera.center,
        this.camera.distance
    ];
};

proto.setData = function registerData (data) {

    var glObject,
        type = data.type,
        uid = data.uid;


    switch (type) {

    case 'surface':
        glObject = this.Surface(data);
        break;

    case 'scatter3d':
        glObject = this.Scatter(data);
        break;
    }

    if (glObject === null) return void 0;

    // uids determine which data is tied to which gl-object
    glObject.uid = data.uid;

    if (!(uid in this.glDataMap)) {
        this.glDataMap[uid] = glObject;
    }
};

proto.updateRenderQueue = function (data, glObject) {

    var visible = (data.visible === false) ? false : true;

    var idx = this.renderQueue.indexOf(glObject);

    if (visible && idx === -1) {

        // add glObject to the render-queue to be drawn
        this.renderQueue.push(glObject);

    } else if (!visible && idx > -1) {

        // item already exists in render-queue but is not hidden, remove.
        this.renderQueue.splice(idx, 1);

    } // other cases we don't need to do anything

    return;
};


proto.setPosition = function (viewport) {
    this.container.style.position = 'absolute';
    this.container.style.left = viewport.left + 'px';
    this.container.style.top = viewport.top + 'px';
    this.container.style.width = viewport.width + 'px';
    this.container.style.height = viewport.height + 'px';
};

proto.getCenter = function () {
    return [
        (this.range[1][0] + this.range[0][0]) / 2,
        (this.range[1][1] + this.range[0][1]) / 2,
        (this.range[1][2] + this.range[0][2]) / 2
    ];
};
/*
 * getDefaultPosition returns the point given by a vector which
 * extends from the center of the scene to the top front corner
 * plus some multiplier mult.
 */
proto.getDefaultPosition = function (mult) {
    var center = this.getCenter(),
        bounds = this.range,
        xtarg = center[0],
        ytarg = center[1],
        ztarg = center[2],
        xcam = (bounds[0][0] < 0) ? bounds[1][0] : bounds[0][0],
        ycam = (bounds[0][1] < 0) ? bounds[1][1] : bounds[0][1],
        zcam = bounds[1][2];

    if (!mult) mult = 1;
    return {
        eye: [
            mult*(xcam - xtarg) + xtarg,
            mult*(ycam - ytarg) + ytarg,
            mult*(zcam - ztarg) + ztarg
        ],
        target: [xtarg, ytarg, ztarg]
    };
};

/**
 * updates the internal maximum data ranges
 * currently being rendered.
 * -- need to add axes.expand for scatterers.
 *
 */
proto.setAxesRange = function () {

    // if glObj not already in renderQueue use this as the
    // starting default, else use the maximal minimal infinite
    // range when computing.
    var i, j, bounds, glObj;
    var axes, axesIn, range;

    if (this.renderQueue.length) {

        // lets calculate the new range over all gl-objects
        range = arrayCopy2D(this.baseRange);
    } else {

        // no gl-objects are in the renderQueue so we
        // use the last range or default
        range = arrayCopy2D(this.range);
    }

    for (j = 0; j < 3; ++j) {

        axes = this.sceneLayout[this.axesNames[j]];

        for (i = 0; i < this.renderQueue.length; ++i) {

            glObj = this.renderQueue[i];
            bounds = glObj.bounds;

            if (!axes.autorange) {
                bounds[0][j] = axes.range[0];
                bounds[1][j] = axes.range[1];
            }

            range[0][j] = Math.min(range[0][j], bounds[0][j]);
            range[1][j] = Math.max(range[1][j], bounds[1][j]);

            if('rangemode' in axes && axes.rangemode === 'tozero') {
                if (range[0][j] > 0 && range[1][j] > 0) range[0][j] = 0;
                if (range[0][j] < 0 && range[1][j] < 0) range[1][j] = 0;
            }

        }
    }

    //Fix up glitches on axes
    for(i=0; i<3; ++i) {
        if(range[0][i] === range[1][i]) {
            range[0][i] -= 1.0;
            range[1][i] += 1.0;
        } else if(range[0][i] > range[1][i]) {
            range[0][i] = -1.0;
            range[1][i] = 1.0;
        }
    }


    //Set clip bounds
    for(i=0; i<this.renderQueue.length; ++i) {
        glObj = this.renderQueue[i];
        glObj.clipBounds = range;
    }

    this.range = range;
};

/**
 * iterates through all surfaces and calculates
 * maximum containing bounds --- autoscale
 *
 */
proto.setModelScale = function () {

    var lo = this.range[0];
    var hi = this.range[1];
    var r0 = hi[0]-lo[0];
    var r1 = hi[1]-lo[1];
    var r2 = hi[2]-lo[2];
    var d0 = -0.5*(hi[0]+lo[0])/r0;
    var d1 = -0.5*(hi[1]+lo[1])/r1;
    var d2 = -0.5*(hi[2]+lo[2])/r2;

    this.model = new Float32Array([
        1.0/r0,  0,      0,    0,
        0,  1.0/r1,      0,    0,
        0,       0, 1.0/r2,    0,
        d0,     d1,     d2,    1
    ]);

};


/**
 * configure the axis of the scene.
 *
 * a seperate method setRange
 */
proto.configureAxes = function configureAxes () {
    /*jshint camelcase: false */

    var mr;
    var axes;
    var sceneLayout = this.layout[this.id];
    var opts = this.axesOpts;

    for (var i = 0; i < 3; ++i) {

        axes = sceneLayout[this.axesNames[i]];

        /////// Axes labels //
        if ('showaxeslabels' in axes) opts.labelEnable[i] = axes.showaxeslabels;
        if ('titlefont' in axes) {
            if (axes.titlefont.color)  opts.labelColor[i] = str2RgbaArray(axes.titlefont.color);
            if (axes.titlefont.family) opts.labelFont[i]  = axes.titlefont.family;
            if (axes.titlefont.size)   opts.labelSize[i]  = axes.titlefont.size;
        }

        /////// LINES ////////
        if ('showline' in axes)  opts.lineEnable[i] = axes.showline;
        if ('linecolor' in axes) opts.lineColor[i]  = str2RgbaArray(axes.linecolor);
        if ('linewidth' in axes) opts.lineWidth[i]  = axes.linewidth;

        if ('showgrid' in axes)  opts.gridEnable[i] = axes.showgrid;
        if ('gridcolor' in axes) opts.gridColor[i]  = str2RgbaArray(axes.gridcolor);
        if ('gridwidth' in axes) opts.gridWidth[i]  = axes.gridwidth;

        if ('zeroline' in axes)      opts.zeroEnable[i]    = axes.zeroline;
        if ('zerolinecolor' in axes) opts.zeroLineColor[i] = str2RgbaArray(axes.zerolinecolor);
        if ('zerolinewidth' in axes) opts.zeroLineWidth[i] = axes.zerolinewidth;

        //////// TICKS /////////
        /// tick lines
        if ('ticks' in axes && !!axes.ticks) opts.lineTickEnable[i] = true;
        else                                 opts.lineTickEnable[i] = false;

        if ('ticklen' in axes) {
            opts.lineTickLength[i] = this.axesOpts._defaultLineTickLength[i] = axes.ticklen;
        }
        if ('tickcolor' in axes) opts.lineTickColor[i] = str2RgbaArray(axes.tickcolor);
        if ('tickwidth' in axes) opts.lineTickWidth[i] = axes.tickwidth;
        if ('tickangle' in axes) {
            opts.tickAngle[i] = axes.tickangle === 'auto' ? 0 : axes.tickangle;
        }
        //// tick labels
        if ('showticklabels' in axes) opts.tickEnable[i] = axes.showticklabels;
        if ('tickfont' in axes) {
            if (axes.tickfont.color)  opts.tickColor[i]  = str2RgbaArray(axes.tickfont.color);
            if (axes.tickfont.family) opts.tickFont[i]   = axes.tickfont.family;
            if (axes.tickfont.size)   opts.tickSize[i]   = axes.tickfont.size;
        }


        if ('mirror' in axes) {
            if (['ticks','all','allticks'].indexOf(axes.mirror) !== -1) {
                opts.lineTickMirror[i] = true;
                opts.lineMirror[i] = true;
            } else if (axes.mirror === true) {
                opts.lineTickMirror[i] = false;
                opts.lineMirror[i] = true;
            } else {
                opts.lineTickMirror[i] = false;
                opts.lineMirror[i] = false;
            }
        }

        ////// grid background
        if ('showbackground' in axes && axes.showbackground !== false) {
            opts.backgroundEnable[i]    = true;
            opts.backgroundColor[i]     = str2RgbaArray(axes.backgroundcolor);
        } else opts.backgroundEnable[i] = false;


        ///// configure axes spikes
        this.spikeProperties.enable[i] = !!axes.showspikes;
        this.spikeProperties.sides[i]  = !!axes.spikesides;
        if(typeof axes.spikethickness !== 'number') {
            axes.spikethickness = 2;
        }
        this.spikeProperties.width[i] = axes.spikethickness;
        if(typeof axes.spikecolor === 'string') {
            this.spikeProperties.colors[i] = str2RgbaArray(axes.spikecolor);
        } else {
            this.spikeProperties.colors[i] = [0,0,0,1];
        }
    }

    this.axesOpts.bounds = this.range;

    if (this.axis) this.axis.update(this.axesOpts);
    else this.axis = createAxes(this.shell.gl, this.axesOpts);
};


proto.isScatter = function (glObj) {
    return 'pointCount' in glObj;
};

proto.toPNG = function () {
    var shell = this.shell;
    var gl = shell.gl;
    var pixels = new Uint8Array(shell.width * shell.height * 4);

    gl.readPixels(0, 0, shell.width, shell.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    //Flip pixels
    var w = shell.width;
    var h = shell.height;
    for(var j=0,k=h-1; j<k; ++j, --k) {
        for(var i=0; i<w; ++i) {
            for(var l=0; l<4; ++l) {
                var tmp = pixels[4*(w*j+i)+l];
                pixels[4*(w*j+i)+l] = pixels[4*(w*k+i)+l];
                pixels[4*(w*k+i)+l] = tmp;
            }
        }
    }

    var canvas = document.createElement('canvas');
    canvas.width = shell.width;
    canvas.height = shell.height;
    var context = canvas.getContext('2d');
    var imageData = context.createImageData(shell.width, shell.height);
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);

    var dataURL = canvas.toDataURL('image/png');
    return dataURL;
};

proto.disposeAll = function disposeAll () {
    this.renderQueue.forEach( function (glo) {
        glo.dispose();
    });
    this.renderQueue = [];
    if (this.axis) {
        this.axis.dispose();
        this.axis = null;
    }
    if(this.select) {
        this.select.dispose();
        this.select = null;
    }
    if(this.axisSpikes) {
        this.axisSpikes.dispose();
        this.axisSpikes = null;
    }
};

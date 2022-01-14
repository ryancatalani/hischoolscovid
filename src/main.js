import * as $ from 'jquery';
import * as L from 'leaflet';
import MarkerClusterGroup from 'leaflet.markercluster';
import Papa from 'papaparse';
import _ from 'underscore';
import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import * as d3 from 'd3-scale';
import Cookies from 'js-cookie';
import * as sparkline from '@fnando/sparkline';

// https://github.com/parcel-bundler/parcel/issues/973#issuecomment-484470626
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

class School {
	constructor(args) {
		this.name = args.name;
		this.lat = args.lat;
		this.long = args.long;
		this.cumulative = args.cumulative;
		this.cumulativePublic = args.cumulativePublic;
		this.cumulativeRecent = args.cumulativeRecent;
		this.marker = args.marker;
		this.id = args.id;
		this.enrollment = args.enrollment;
		this.prevTwoWeeks = args.prevTwoWeeks;
		this.twoWeekChange = args.twoWeekChange;
		this.teachers = args.teachers;
		this.adminFTE = args.adminFTE;
	}
	safeName() {
		return createSafeName(this.name);
	}
	cumulativeText() {
		var text = this.cumulative;
		if (this.cumulativePublic !== undefined && this.cumulativePublic > 0) {
			var doeTotal = this.cumulative - this.cumulativePublic;
			text += " (DOE reported: " + doeTotal + ", "
			text += "public submissions: " + this.cumulativePublic + ")";
		}
		return text;
	}
	cumulativeRecentText() {
		return this.cumulativeRecent;
	}
	ratioLabel() {
		if (isNotNumber(this.teachers) && isNotNumber(this.adminFTE)) {
			return "students";
		}
		return "students & staff";
	}
	ratioDescription() {
		var text = "";
		if (this.ratioBase() > 0) {
			text += "SY21-22 enrollment: " + this.enrollment.toLocaleString();
			if (!isNotNumber(this.teachers) || !isNotNumber(this.adminFTE)) {
				text += ". SY19-20 staff: "
			}
			if (!isNotNumber(this.teachers)) {
				text += this.teachers + " teachers"
			}
			if (!isNotNumber(this.teachers) && !isNotNumber(this.adminFTE)) {
				text += " and "
			}
			if (!isNotNumber(this.adminFTE)) {
				text += this.adminFTE.toLocaleString() + " administrative staff (FTE)";
			}
			if (isNotNumber(this.teachers) && isNotNumber(this.adminFTE)) {
				text += ". Note that not all cases are from students"
			}
			text += ".";
		}
		return text;
	}
	ratioBase() {
		var base = 0;
		if (!isNotNumber(this.enrollment)) {
			base += this.enrollment;
			if (!isNotNumber(this.teachers)) {
				base += this.teachers;
			}
			if (!isNotNumber(this.adminFTE)) {
				base += Math.round(this.adminFTE);
			}
		}
		return base;
	}
	caseRatio() {
		if (this.ratioBase() > 0 && this.cumulative !== undefined && this.cumulative > 0) {
			return (1.0 * this.ratioBase()) / this.cumulative;	
		}
		return 0;
	}
	recentCaseRatio() {
		if (this.ratioBase() > 0 && this.cumulativeRecent !== undefined && this.cumulativeRecent > 0) {
			return (1.0 * this.ratioBase()) / this.cumulativeRecent;	
		}
		return 0;	
	}
	recentCaseRatioText() {
		if (this.recentCaseRatio() > 0) {
			return "1:" + Math.round(this.recentCaseRatio()).toLocaleString();
		}
		return "N/A";
	}
	invertedRatio() {
		if (this.ratioBase() > 0 && this.cumulative !== undefined && this.cumulative > 0) {
			return (1.0 * this.ratioBase()) / this.enrollment;
		}
		return 0;	
	}
	recentInvertedRatio() {
		if (this.recentCaseRatio() > 0) {
			return 1.0 / this.recentCaseRatio();
		}
		return 0;
	}
	twoWeekChangeText() {
		if (!isNotNumber(this.twoWeekChange)) {
			var pct = Math.round(this.twoWeekChange * 1000)/10.0;

			if (pct == 0) {
				return "<span class='twoWeekChange none'>No change</span>";
			} else if (pct > 0) {
				return `<span class="twoWeekChange up"><i class="fas fa-arrow-circle-up"></i> ${pct.toLocaleString()}%</span>`
			} else {
				return `<span class="twoWeekChange down"><i class="fas fa-arrow-circle-down"></i> ${pct.toLocaleString() * -1}%</span>`
			}
		}
		return "";
	}
	element(useID) {
		var id = useID === true ? this.safeName() : "";
		var template = `<div class='school ${id}' data-name='${this.safeName()}'>
			<div class='schoolName'>
				${this.name}
				<span class='schoolBtns'>
					<span class='zoomTo' data-lat='${this.lat}' data-long='${this.long}'><i class='fas fa-search-plus'></i> Zoom to this school</span>
					<span class='pinBtnWrap'>
						<span class='pinSchool pinBtn'><i class="fas fa-thumbtack"></i> Pin this school</span>
						<span class='unpinSchool pinBtn'><i class="far fa-thumbtack"></i> Unpin</span>
					</span>
				</span>
			</div>
			<div class='schoolStats'>
					<div class='statLabel'>Recent cases (last 2 weeks)</div>
					<div class='statLabel trendLabel'>Trend (last 2 weeks)</div>
					<div class='statLabel'>Ratio of recent cases to ${this.ratioLabel()}</div>
					<div class='statLabel'>Total cases reported</div>
					<div class='statValue'>
						${this.cumulativeRecentText()}
						${this.twoWeekChangeText()}
					</div>
					<div class='trend'></div>
					<div class='statValue'>${this.recentCaseRatioText()}</div>
					<div class='statValue'>${this.cumulativeText()}</div>
			</div>
			<div class='schoolDataNotes'>${this.ratioDescription()} Percent change compares cases reported in last two weeks (${this.cumulativeRecent}) against cases reported in the previous two-week period (${this.prevTwoWeeks}).</div>
		</div>`;
		return template;
	}
}
class Case {
	constructor(args) {
		this.school = args.school;
		this.dateReported = args.dateReported;
		this.lastDateOnCampus = args.lastDateOnCampus;
		this.reportingPeriod = args.reportingPeriod;
		this.source = args.source;
		this.status = args.status;
		this.publicSubmission = args.publicSubmission;
		this.count = args.count;
	}
	dateReportedJS() {
		return new Date(this.dateReported);
	}
	sourceText() {
		if (this.publicSubmission) {
			return "Public submission";
		} else if (this.reportingPeriod !== undefined && this.reportingPeriod !== "") {
			return "DOE data • Reporting period: " + this.reportingPeriod;	
		}
		return "DOE data";
	}
	classText() {
		var c = "case";
		if (this.publicSubmission) {
			c += " publicSubmission";
		}
		return c;
	}
	caseText() {
		if (this.count > 1) {
			return "Cases (" + this.count + ")";
		}
		return "Case";
	}
	element() {
		var template = _.template("<div class='<%= classText %>'><p><strong><%= caseText %> <%= status %></strong></p><p>Date reported: <%= dateReported %></p><p>Last date individual was on campus: <%= lastDateOnCampus %></p><p>Source: <%= sourceText %></p><a href='<%= source %>' target='_blank'>View source</a>");
		return template({
			caseText: this.caseText(),
			classText: this.classText(),
			dateReported: this.dateReported,
			lastDateOnCampus: this.lastDateOnCampus,
			sourceText: this.sourceText(),
			source: this.source,
			status: this.status
		});
	}
}
class ComplexArea {
	constructor(args) {
		this.name = args.name,
		this.geoJSON = args.geoJSON,
		this.caseTotal = args.caseTotal,
		this.recentCaseTotal = args.recentCaseTotal
	}
}

// Globals

var allSchools = [];
var allCases = [];
var allComplexAreas = [];
var allSparklineData;
var windowWidth;
var pinnedSchools = [];
var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var today = new Date();
today.setHours(0,0,0,0);

// Helpers

function isNotNumber(input) {
	return input === null || isNaN(input);
}

function createSafeName(input) {
	return input.replace(/[^a-zA-Z]/gi, "").toLocaleUpperCase();
}

Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
}

function getDates(startDate, stopDate) {
    var dateArray = new Array();
    var currentDate = startDate;
    while (currentDate <= stopDate) {
        dateArray.push(new Date (currentDate));
        currentDate = currentDate.addDays(1);
    }
    return dateArray;
}

function dateFormat(d) {
	return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear()
}

function groupCasesByDate(args) {
	var cases = args.cases;
	var caseMinDate = args.min;
	var caseMaxDate = args.max;
	var initialValue = args.initialValue;

	var dateRange = getDates(caseMinDate, caseMaxDate);
	var casesByDate = _.chain(cases)
		.groupBy(function(c) { return c.dateReported })
		.mapObject(function(value) {
			var sum = _(value).reduce(function(memo, num) { return memo + num.count}, 0);
			return sum;
		})
		.value();
	
	var finalData = _(dateRange).map(function(d) {
		var dateStr = dateFormat(d);
		var caseCount = casesByDate[dateStr];
		if (caseCount === undefined) {
			caseCount = 0;
		}
		return {date: dateStr, dailyValue: caseCount, value: 1};
		// value key will be cumulative value
	});

	_.chain(finalData)
		.map(function(d) { return d.dailyValue })
		.reduce(function(a,b,i){ 
			return finalData[i].value = a+b;
			// set value key to cumulative value
		}, initialValue);

	return finalData;
}

function findClosest(target, tagName) {
  if (target.tagName === tagName) {
    return target;
  }

  while ((target = target.parentNode)) {
    if (target.tagName === tagName) {
      break;
    }
  }

  return target;
}

var sparklineOptions = {
  fetch(entry) {
  	return entry.c;
  },
  onmousemove(event, datapoint) {
    var svg = findClosest(event.target, "svg");
    var tooltip = svg.nextElementSibling;
    var date = datapoint.date;
    var plur = datapoint.c === 1 ? "" : "s";

    tooltip.hidden = false;
    tooltip.textContent = `${date}: ${datapoint.c} case${plur} reported`;
    tooltip.style.top = `${event.offsetY - 23}px`;
    tooltip.style.left = `${event.offsetX + 20}px`;
  },
  onmouseout() {
    var svg = findClosest(event.target, "svg");
    var tooltip = svg.nextElementSibling;
    tooltip.hidden = true;
  }
};


$(function() {

	// Set up map

	windowWidth = $(window).width();
	var defaultZoom = 7;
	if ($(window).width  > 700) {
		defaultZoom = 8;
	}
	var calculateLayout = _.debounce(function(){
		windowWidth = $(window).width();
	}, 300);
	$(window).resize(calculateLayout);

	// https://github.com/Leaflet/Leaflet/issues/7255#issuecomment-849638476
	var schoolMap = L.map('schoolMap', {
		center: [21.311389, -157.796389],
		zoom: defaultZoom,
		"tap": false
	});

	L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
		subdomains: 'abcd',
		maxZoom: 19
	}).addTo(schoolMap);

	var markers = L.markerClusterGroup({
		iconCreateFunction: function(cluster) {
			return L.divIcon({ 
				html: '<div class="clusterIconCount"><strong>' + cluster.getChildCount() + '</strong> Schools</div>',
				className: "clusterIcon",
				iconSize: [40,40]
			});
		}
	});

	markers.on('clusterclick', function (a) {
		a.layer.zoomToBounds({padding: [20, 20]});
	});

	// Set up about data header

	$("#aboutDataHeader").click(function() {
		$("#aboutDataInner").slideToggle("fast");
	});

	// Set up cases click

	$("#schoolList, #pinnedSchoolList").on("click", ".casesLabel", function() {
		var $casesWrap = $(this).next();
		$(this).toggleClass("active");
		
		if (allCases.length === 0) {
			// Load data
			$casesWrap.append('<div class="loading"><i class="fas fa-cog fa-spin"></i> Loading…</div>');
			$casesWrap.slideDown("fast", function(){
				$.when(pparse(casesURL)).done(function(casesData){
					_(casesData.reverse()).each(function(row, index) {
						var theCase = new Case({
							school: row.school,
							dateReported: row.date_reported_str,
							publicSubmission: row["Public Submission"] == "TRUE",
							count: row.count,
							lastDateOnCampus: row.last_date_on_campus,
							source: row.source
						});
						if (row.source === "" || row.source === null) {
							theCase.source = "https://public.tableau.com/app/profile/hidoe.dga/viz/COVID-19HIDOECaseCountPublicDashboard/List";
						}
						allCases.push(theCase);

						var schoolName = createSafeName(theCase.school);
						var $schoolEl = $("." + schoolName);
						$schoolEl.find('.casesInner').append( theCase.element() );
					});
					_(allSchools).each(function(school) {
						var $schoolEl = $("." + createSafeName(school.name));
						$schoolEl.find('.casesInner').css('width', 310 * school.cumulative + 'px');	
					});
					$casesWrap.find(".loading").slideUp("fast");
				});
			});
		} else {
			$casesWrap.slideToggle("fast");
		}
	});

	// Set up pin click

	function pinSchool(schoolEl, animate) {
		var schoolName = schoolEl.data("name");
		var $pinnedEl = schoolEl.clone().appendTo("#pinnedSchoolList");
		$("." + schoolName).addClass("pinned");
		pinnedSchools.push(schoolName);

		$pinnedEl.find(".trend").empty();

		var originalName = _(allSchools).find(function(s) {return s.safeName() === schoolName}).name;
		createSparkline(originalName, "#pinnedSchoolList");

		if (animate) {
			var scrollTo = $("#pinnedSchoolList").offset().top;
			if (windowWidth < 800) {
				scrollTo -= $("#schoolMapWrap").height();
			}

			$("html, body").animate({scrollTop: scrollTo});	
			$(".headerWithPins").slideDown("fast");
		} else {
			$(".headerWithPins").show();
		}
	}

	$("#schoolList, #pinnedSchoolList").on("click", ".pinBtn", function() {
		var $schoolEl = $(this).parents(".school");
		var schoolName = $schoolEl.data("name");

		if (!$schoolEl.hasClass("pinned")) {
			// Add pin

			pinSchool($schoolEl, true);
		} else {
			// Remove pin
			$("#pinnedSchoolList").find("."+schoolName).slideUp("fast", function() {
				$(this).remove();
			});

			$("." + schoolName).removeClass("pinned");
			var index = pinnedSchools.indexOf(schoolName);
			pinnedSchools.splice(index, 1);

			if (pinnedSchools.length == 0) {
				$(".headerWithPins").slideUp("fast");				
			}
		}

		Cookies.set('pins', JSON.stringify(pinnedSchools), {expires: 365});
	});

	// Set up filter

	var runFilter = _.debounce(function() {
		$("#loading").slideDown("fast");
		var input = createSafeName($("#filterInput").val());

		if (input == "") {
			$("#filterClear").hide();
			$("#loading").slideUp("fast");
			_(allSchools).each(function(school) {
				if (school.marker !== undefined && !markers.hasLayer(school.marker)) {
					var marker = school.marker;
					markers.addLayer(marker);
				}
			});
			return $(".school").show();
		}

		$("#filterClear").show();
		$("#schoolList").find(".school").each(function() {
			var name = $(this).data('name');
			var school = _(allSchools).find(function(s) {
				return s.safeName() == name;
			});
			
			var schoolHasMarker = false;
			var marker;
			if (school !== undefined && school.marker !== undefined ) {
				schoolHasMarker = true;
				marker = school.marker;
			}

			if (name.indexOf(input) >= 0) {
				$(this).show();
				if ( schoolHasMarker && !markers.hasLayer(marker) ) {
					markers.addLayer(marker);
				}
			} else {
				$(this).hide();
				if ( schoolHasMarker && markers.hasLayer(marker) ) {
					markers.removeLayer(marker);
				}
			}
		});
		$("#loading").slideUp("fast");
	}, 150);

	$("#filterInput").keyup(runFilter);
	$("#filterClear").click(function() {
		$("#filterInput").val("").trigger("keyup");
	})

	// Set up sorting

	$(".sortKey").click(function() {
		if ( $(this).hasClass("active") )
			return;

		$(".sortKey").removeClass("active");
		$("#schoolList").empty();

		var key = $(this).data("key");
		displayData({allSchools: allSchools, sortKey: key});

		$(this).addClass("active");
	});

	// Set up Zoom

	$("#schoolList, #pinnedSchoolList").on("click", ".zoomTo", function() {
		var lat = $(this).data("lat");
		var long = $(this).data("long");
		// schoolMap.flyTo([lat, long], 12, {duration: 0.2});

		var name = $(this).parents(".school").data("name");
		var school = _(allSchools).find(function(s) { return s.safeName() == name });
		if (school !== undefined && school.marker !== undefined ) {
			var marker = school.marker;
			markers.zoomToShowLayer(marker, function() {
				marker.openPopup();
			});
		}
	});

	// Set up data display

	function createSparkline(schoolName, parentSelector) {
		var sparklineData = allSparklineData[schoolName];
		
		var sparklineID = `${parentSelector} .${createSafeName(schoolName)} .trend`;
		var sparklineWidth = Math.max(80, Math.min(100, Math.floor( $(window).width() / 6 )));
		var $sparkline = $(`<svg class='sparkline' width='${sparklineWidth}' height='26' stroke-width='2'></svg><span class='tooltip' hidden='true'></span>`);
		$(sparklineID).append($sparkline);

		sparkline.sparkline(document.querySelector(sparklineID + " svg"), sparklineData, sparklineOptions);
	}

	function displayData(args) {
		// var allSchools = args.allSchools;
		var schoolMap = args.schoolMap;
		var sortKey = args.sortKey;

		_.chain(allSchools).sortBy(function(school) {
			return school.name;
		}).reverse().sortBy(function(school) {
			if (sortKey === "ratio") {
				return school.recentInvertedRatio();
			} else if (sortKey === "recent") {
				return school.cumulativeRecent;
			} else if (sortKey === "change") {
				if (isNotNumber(school.twoWeekChange)) {
					return 0;
				}
					return school.twoWeekChange;
			}
			return school.cumulative;
		}).reverse().each(function(school) {
			var $schoolEl = $(school.element(true));

			if (pinnedSchools.indexOf(school.safeName()) > -1) {
				$schoolEl.addClass("pinned");
			}

			// Enable for case display
			$schoolEl.find(".schoolStats").after("<div class='casesLabel'><i class='fas fa-list'></i> <strong>View individual cases</strong> <em>(Note that DOE data may not list every individual case.)</em></div><div class='casesOuter'><div class='casesInner'></div></div>");
			$("#schoolList").append( $schoolEl );

			if (schoolMap !== undefined) {
				if (school.lat !== undefined && school.long !== undefined) {
					var icon =  L.divIcon({
						className: 'marker-icon',
						html: '<i id="marker' + school.id + '" class="fas fa-map-pin fa-3x"></i>',
						iconSize: [20,36],
						iconAnchor: [10,36],
						popupAnchor: [0,-20]
					});

					var marker = L.marker([school.lat, school.long]);
					marker.bindPopup(school.element(false));
					markers.addLayer(marker);

					school.marker = marker;	
				}

				schoolMap.addLayer(markers);	
			}	

			if (allCases.length > 0) {
				_.chain(allCases).filter(function(theCase) {
					return theCase.school == school.name;
				}).each(function(theCase) {
					$schoolEl.find('.casesInner').append( theCase.element() );
					$schoolEl.find('.casesInner').css('width', 310 * school.cumulative + 'px');
				});
			}


			if (school.cumulativeRecent > 0) {
				// Sparkline
				createSparkline(school.name, "#schoolList");
			}

		});
	}

	// Set up data

	var casesURL = "https://rcpublic.s3.amazonaws.com/doe_cases/cases.csv";
	var schoolsURL = "https://rcpublic.s3.amazonaws.com/doe_cases/schools.csv";
	var complexAreasURL = "https://rcpublic.s3.amazonaws.com/doe_cases/School_Complex_Areas.geojson";
	var complexAreasDataURL = "https://rcpublic.s3.amazonaws.com/doe_cases/complexareas.json"
	var metaURL = "https://rcpublic.s3.amazonaws.com/doe_cases/meta.json";

	function pparse(url) {
		var d = $.Deferred();
		Papa.parse(url, {
			download: true,
			header: true,
			dynamicTyping: true,
			complete: function(results) {
				d.resolve(results.data);
			}
		});
		return d.promise();
	}
	function getJSONPromise(url) {
		var d = $.Deferred();
		$.getJSON(url, function(data){
			d.resolve(data);
		});
		return d.promise();
	}

	$.when( pparse(schoolsURL), getJSONPromise(metaURL) , getJSONPromise(complexAreasURL), getJSONPromise(complexAreasDataURL) )
		.done(function(schools, metaData, complexAreas, complexAreasData) {

			// Parse complex areas

			_(complexAreas.features).map(function(row) {
				var areaName = row.properties.complex_area;
				var areaData = _(complexAreasData).find(function(c) { return c.name == areaName });

				var complex = new ComplexArea({
					name: areaName,
					geoJSON: row,
					caseTotal: areaData.total,
					recentCaseTotal: areaData.recent_total
				});
				allComplexAreas.push(complex);
			});

			// Parse data

			_(schools).each(function(row) {
				var school = new School({
					name: row.name,
					cumulative: row.cumulative,
					cumulativeRecent: row.cumulative_recent,
					prevTwoWeeks: row.prev_two_weeks,
					twoWeekChange: row.two_week_change,
					lat: row.lat,
					long: row.long,
					enrollment: row.enrollment,
					teachers: row.teachers,
					adminFTE: row.admin_fte,
					id: row.id
				});
				allSchools.push(school);
			});

			$("#grandTotalText").text(metaData.grand_total.toLocaleString());
			$("#lastUpdatedText").text(metaData.last_updated);
			$("#lastUpdated").slideDown("fast");

			// _(casesData).each(function(row) {
			// 	var theCase = new Case({
			// 		school: row.school,
			// 		dateReported: row.date_reported_str,
			// 		publicSubmission: row["Public Submission"] == "TRUE",
			// 		count: row.count,
			// 		lastDateOnCampus: row.last_date_on_campus,
			// 		source: row.source
			// 	});
			// 	allCases.push(theCase);
			// });

			// Display data

			allSparklineData = metaData.schools_last_2_weeks;
			displayData({allSchools: allSchools, schoolMap: schoolMap, sortKey: "recent" });

			// Display complex areas
			var complexAreaCounts = _.chain(allComplexAreas).map(function(complex) {
				return complex.recentCaseTotal;
			}).filter(function(num) {
				return num > 0;
			}).value().sort(function(a,b) {
				return a-b;
			});
			var minCaseCount = complexAreaCounts[0];
			var maxCaseCount = complexAreaCounts[complexAreaCounts.length-1];

			var colorRange = ["#fecc5c","#fd8d3c","#f03b20","#bd0026"];
			// var colorRange = ["#faa476","#f0746e","#dc3977","#b9257a"];
			var scale = d3.scaleQuantile()
				.domain([0, 100])
				.range(colorRange);
			
			var colorLegend = "<div id='legend'><strong>Cases in complex area in past 2 weeks</strong><ul>";
			var quantiles = scale.quantiles();
			console.log(quantiles);
			for (var i = 0; i < colorRange.length; i++) {
				var color = colorRange[i];
				var separator = "-";
				var lowerBound = quantiles[i-1];
				if (lowerBound === undefined) {
					lowerBound = 0;
				}
				var upperBound = quantiles[i];
				if (upperBound === undefined) {
					upperBound = "";
					separator = "+";
				} else {
					upperBound = Math.floor(upperBound);
				}
				colorLegend += `<li>
					<span class='legendColor' style='background-color:${color}'></span>
					${Math.ceil(lowerBound)}${separator}${upperBound}
				</li>`;
			}
			$("#schoolMapWrap").append(colorLegend);

			_(allComplexAreas).each(function(complex) {
				if (complex.caseTotal > 0) {
					var color = scale(complex.recentCaseTotal);
					L.geoJSON(complex.geoJSON, {
						style: {
							"color": color,
							"weight": 1,
							"opacity": 0.9,
							"fillOpacity": 0.5
						}
					}).addTo(schoolMap);
				}
			});

			// Create all cases chart

			Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, roboto, noto, arial, sans-serif";

			var chartData = metaData.all_cases_by_date;
			var allCasesChartCtx = document.getElementById('allCases').getContext('2d');
			var allCasesChart = new Chart(allCasesChartCtx, {
				data: {
					datasets: [{
						type: 'bar',
						label: 'Cases reported per day',
						data: _(chartData).map(function(c) {return c.d}),
						backgroundColor: "#ddd",
						pointBackgroundColor: "#ddd",
						borderColor: "#ddd",
						pointRadius: 2,
						pointBorderRadius: 0,
						order: 2
					}, {
						type: 'line',
						label: '7-day average of cases reported',
						data: _(chartData).map(function(c) {return c.a}),
						pointRadius: 0,
						backgroundColor: "#666",
						borderColor: "#666",
						order: 1
					}],
					labels: _(chartData).map(function(c) {return new Date(c.date)})
				},
				options: {
					// aspectRatio: 2.5,
					maintainAspectRatio: false,
					interaction: {
						mode: 'index',
						intersect: false
					},
					scales: {
						x: {
							type: 'timeseries',
							time: {
								unit: 'month'
							},
							grid: {
								display: false
							},
							ticks: {
								display: true
							}
						},
						y: {
							ticks: {
								count: 3
							},
							grid: {
								// borderDash: [4, 4]
							}
						}
					},
					plugins: {
						tooltip: {
							position: 'nearest',
							callbacks: {
								title: function(context) {
									var d = new Date(context[0].parsed.x);
									return dateFormat(d);
								}
							}
						},
						legend: {
							position: 'bottom',
							labels: {
								boxWidth: 6,
								boxHeight: 6,
								usePointStyle: true,
								pointStyle: 'circle'
							}
						}
					}
				}
			});

			// Set up pins from cookie
			if (Cookies.get("pins") !== undefined) {
				var existingPins = JSON.parse(Cookies.get("pins"));
				_(existingPins).each(function(schoolName) {
					var $schoolEl = $("."+schoolName);
					pinSchool($schoolEl, false);
				});
			}


			// Finish loading
			$(".loading").slideUp("fast");

		});

});
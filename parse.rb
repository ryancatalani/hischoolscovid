require "dotenv/load"
require "roo"
require "date"
require "smarter_csv"
require "aws-sdk-s3"
require "json"
require "csv"
require "pry"

def to_csv_str(arr)
	# Array of hashes
	csv_str = CSV.generate do |csv|
		csv << arr.first.keys
		arr.each do |row|
			csv << row.values
		end
	end
	return csv_str.chomp
end

def group_cases_by_date(args)
	cases = args[:cases]
	case_min_date = args[:min]
	case_max_date = args[:max]
	initial_value = args[:initial_value]

	# d: daily, c: cumulative, a: 7-day average

	grouped = (case_min_date..case_max_date).map do |date|
		{
			date: date.strftime("%B %d, %Y"),
			d: cases.filter{|c| c[:date_reported] == date }.sum{|c| c[:count]}
		}
	end
	grouped.each_with_index do |g,i|
		cumulative = grouped[0..i+1].sum{|c| c[:d]} + initial_value
		grouped[i][:c] = cumulative

		if i >= 6
			# at least 7 days of values
			avg = grouped[i-6..i].sum{|c| c[:d]}.to_f / 7.0
			grouped[i][:a] = avg.round
		end
	end

	return grouped
end

def parse_cases(sheet, s3)
	parsed_cases = []

	first_row = 1
	last_row = sheet.last_row

	(first_row..last_row).each do |row_index|

		complex_area = sheet.cell(row_index, 1)
		if complex_area.nil?
			# Move back 2: 
			# - 1 because row_index starts at 1, not 0
			# - 1 to move back to previous array item
			complex_area = parsed_cases[row_index-2][:complex_area]
		end

		school = sheet.cell(row_index, 2)
		if school.nil?
			school = parsed_cases[row_index-2][:school]
		else
			# Data checks
			school_name_col = 2
			school_meta_col = 4

			# Check for newline
			school = school.gsub(/\n/," ")

			# Check if cell parsed with next column data
			school_with_next_col_regex = /([a-zA-Z& ]+?)\s{2,}(\d+)/
			if school =~ school_with_next_col_regex
				school = school.match(school_with_next_col_regex)[1]
			end
			# Check if school name is incomplete
			# Check next row
			this_row_has_meta = !sheet.cell(row_index, school_meta_col).nil?
			next_row_has_name = !sheet.cell(row_index+1, school_name_col).nil?
			next_row_has_meta = !sheet.cell(row_index+1, school_meta_col).nil?
			if this_row_has_meta && next_row_has_name && !next_row_has_meta
				school = "#{school.strip} #{sheet.cell(row_index+1, school_name_col).strip}"
			end
			# Then, check preceeding row
			prev_row_has_name = !sheet.cell(row_index-1, school_name_col).nil?
			prev_row_has_meta = !sheet.cell(row_index-1, school_meta_col).nil?
			if prev_row_has_name && prev_row_has_meta && !this_row_has_meta
				school = "#{sheet.cell(row_index-1, school_name_col).strip} #{school}"
			end
			# Check if next row name is the same,
			# then check the next row after that.
			# (This can happen on a PDF line break)
			next_row_name = sheet.cell(row_index+1, school_name_col)
			subsequent_row_name = sheet.cell(row_index+2, school_name_col)
			subsequent_row_has_meta = !sheet.cell(row_index+2, school_meta_col).nil?
			if next_row_has_name && school == next_row_name && !subsequent_row_name.nil? && !subsequent_row_has_meta
				school = "#{school} #{subsequent_row_name.strip}"
			end
		end

		date_reported_str = sheet.cell(row_index, 6)
		date_reported = nil
		if date_reported_str.nil?
			date_reported_str = parsed_cases[row_index-2][:date_reported_str]
			date_reported = parsed_cases[row_index-2][:date_reported]
		else
			date_reported = Date.parse(date_reported_str)
		end

		last_date_on_campus = sheet.cell(row_index, 7)
		if last_date_on_campus.nil?
			last_date_on_campus = "Unspecified"
		end

		island = sheet.cell(row_index, 8)
		count = sheet.cell(row_index, 9)
		source = ""

		if (island =~ /\n/ && count =~ /\n/)
			# PDF parsed incorrectly and row needs to be manually split
			split_islands = island.split("\n")
			split_count = count.split("\n")

			if split_islands.count != split_count.count
				puts "⚠️  Alert: Mismatch in split: row #{row_index}"
			end

			split_islands.count.times do |split_index|
				the_case = {
					complex_area: complex_area,
					school: school,
					date_reported_str: date_reported_str,
					date_reported: date_reported,
					last_date_on_campus: last_date_on_campus,
					# island: split_islands[split_index],
					count: split_count[split_index].to_i,
					source: source
				}
				parsed_cases << the_case
			end
		else
			# Normal, expected circumstance
			the_case = {
				complex_area: complex_area,
				school: school,
				date_reported_str: date_reported_str,
				date_reported: date_reported,
				last_date_on_campus: last_date_on_campus,
				# island: island,
				count: count.to_i,
				source: source
			}
			parsed_cases << the_case
		end

	end

	grand_total = parsed_cases.sum{|c| c[:count] }
	puts "Grand total: #{grand_total}"

	parsed_cases.sort_by!{|c| c[:date_reported]}

	latest_case_date = parsed_cases.last[:date_reported]
	all_cases_by_date = group_cases_by_date({
		cases: parsed_cases,
		min: Date.parse("July 28, 2021"),
		max: latest_case_date,
		initial_value: 0
	})

	meta = {
		last_updated: Time.now.strftime("%B %d, %Y"),
		grand_total: grand_total,
		all_cases_by_date: all_cases_by_date
	}

	return {
		parsed_cases: parsed_cases,
		meta: meta,
		latest_case_date: latest_case_date
	}
end

def parse_schools(parsed_cases, latest_case_date, meta, s3)
	schools = []
	schools_meta = {}
	all_school_data = SmarterCSV.process('schoolslist.csv')

	school_names = parsed_cases.map{|c| c[:school]} + all_school_data.map{|s| s[:sch_name]}
	school_names.uniq!.sort!

	school_names.each do |school_name|

		school_cases = parsed_cases.filter{|c| c[:school] == school_name}
		
		cumulative_recent = school_cases.filter{|c| latest_case_date - c[:date_reported] <= 14}.sum{|c| c[:count]}
		prev_two_weeks = school_cases.filter{ |c| 
			(latest_case_date - c[:date_reported] > 14) && (latest_case_date - c[:date_reported] <= 28)
		}.sum{|c| c[:count]}
		two_week_change = "N/A"

		if (prev_two_weeks > 0) 
			two_week_change = (cumulative_recent.to_f - prev_two_weeks.to_f) / (prev_two_weeks.to_f)
		end

		the_school = {
			name: school_name,
			cumulative_recent: cumulative_recent,
			cumulative: school_cases.sum{|c| c[:count]},
			prev_two_weeks: prev_two_weeks,
			two_week_change: two_week_change
		}

		school_data = all_school_data.find{|s| s[:sch_name] == school_name }
		if school_data.nil?
			puts "⚠️  Alert: No data found for #{school_name}"
		else
			# School data found
			the_school.merge!({
				lat: school_data[:y],
				long: school_data[:x],
				id: school_data[:sch_code],
				enrollment: school_data[:enrollment],	
				teachers: school_data[:teachers],
				admin_fte: school_data[:adminfte]
			})
		end

		schools << the_school

		daily_cases_last_2_weeks = group_cases_by_date({
			cases: school_cases,
			min: latest_case_date - 14,
			max: latest_case_date,
			initial_value: school_cases.filter{|c| c[:date_reported] < (latest_case_date-14) }.sum{|c| c[:count]}
		})
		# puts school_name
		# pp daily_cases_last_2_weeks
		schools_meta[school_name] = daily_cases_last_2_weeks
	end

	meta[:schools_last_2_weeks] = schools_meta

	return {
		schools: schools,
		meta: meta
	}

	
end

def parse_complex_areas(parsed_cases, latest_case_date, s3)
	complex_areas = []
	
	geojson = JSON.parse(File.read("School_Complex_Areas.geojson"))
	geojson["features"].each_with_index do |feature, index|
		complex_area_name = feature["properties"]["complex_area"]

		cases_in_area = parsed_cases.filter{|c| c[:complex_area].upcase == complex_area_name }
		recent_cases_in_area = cases_in_area.filter{|c| latest_case_date - c[:date_reported] <= 14 }

		complex_areas << {
			name: complex_area_name,
			total: cases_in_area.sum{|c| c[:count]},
			recent_total: recent_cases_in_area.sum{|c| c[:count]}
		}

		# geojson["features"][index]["properties"]["case_total"] = cases_in_area.sum{|c| c[:count]}
		# geojson["features"][index]["properties"]["recent_case_total"] = recent_cases_in_area.sum{|c| c[:count]}
	end

	return complex_areas
end

def run
	s3 = Aws::S3::Resource.new(region: ENV['S3_REGION'])
	xlsx = Roo::Spreadsheet.open(ARGV[0])
	sheet = xlsx.sheet(0)
	
	parsed_cases_values = parse_cases(sheet, s3)
	parsed_cases = parsed_cases_values[:parsed_cases]
	intermediate_meta = parsed_cases_values[:meta]
	latest_case_date = parsed_cases_values[:latest_case_date]

	complex_areas = parse_complex_areas(parsed_cases, latest_case_date, s3)
	
	schools_values = parse_schools(parsed_cases, latest_case_date, intermediate_meta, s3)
	schools = schools_values[:schools]
	meta = schools_values[:meta]

	puts "Save to S3? [Y/N]"
	save_to_s3 = $stdin.gets.chomp

	if save_to_s3 == "Y"
		s3.bucket(ENV['S3_BUCKET']).object("doe_cases/cases.csv").put(body: to_csv_str(parsed_cases), acl: "public-read")
		puts "✅  Saved cases to S3."

		s3.bucket(ENV['S3_BUCKET']).object("doe_cases/complexareas.json").put(body: complex_areas.to_json, acl: "public-read")
		puts "✅  Saved complex areas to S3."

		s3.bucket(ENV['S3_BUCKET']).object("doe_cases/schools.csv").put(body: to_csv_str(schools), acl: "public-read")
		puts "✅  Saved schools to S3."

		s3.bucket(ENV['S3_BUCKET']).object("doe_cases/meta.json").put(body: meta.to_json, acl: "public-read")
		puts "✅  Saved meta to S3."
	end

end

run